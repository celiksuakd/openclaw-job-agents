#!/usr/bin/env node
// JobSquad CLI: the tracker and guardrails shared by every JobSquad agent.
// Zero dependencies: runs on the Node that OpenClaw already installs (needs node:sqlite).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, loadAnswers, loadConfig, paths, readJsonc, HOME } from './lib/config.mjs';
import { open, now, getJob, setStatus, logEvent, appendNote, hasEvent, meta, STATUSES, OPEN_STATUSES } from './lib/db.mjs';
import { BOARD_SOURCES, FEED_SOURCES, detectAts } from './lib/sources.mjs';
import { matchTerm, norm } from './lib/text.mjs';
import { canApply } from './lib/policy.mjs';
import { runQa } from './lib/qa.mjs';
import { toHtml, htmlToPdf, findChrome } from './lib/render.mjs';

const VERSION = '1.0.0';
const BOOL_FLAGS = new Set(['json', 'quiet', 'dry-run', 'full', 'approved', 'manual', 'all', 'no-mark', 'help']);

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    if (inline !== undefined) opt[k] = inline;
    else if (BOOL_FLAGS.has(k) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) opt[k] = true;
    else opt[k] = argv[++i];
  }
  return { pos, opt };
}

const out = (o, asJson) => console.log(asJson ? JSON.stringify(o, null, 2) : o);
const fail = (msg, code = 1) => { console.error(`error: ${msg}`); process.exit(code); };
const ids = (list) => list.flatMap((s) => String(s).split(/[,\s]+/)).filter(Boolean).map((s) => Number(s.replace(/^#/, ''))).filter(Number.isFinite);
const short = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const fpOf = (j) => [norm(j.company), norm(j.title), norm(j.location).slice(0, 40)].join('|');

// ---------------------------------------------------------------- prefilter
function prefilter(job, s) {
  const title = job.title || '';
  if (s.titles?.length && !s.titles.some((t) => matchTerm(title, t))) return 'title not in target list';
  const ex = (s.exclude_title || []).find((t) => matchTerm(title, t));
  if (ex) return `title excluded (${ex})`;
  if ((s.exclude_companies || []).some((c) => norm(c) === norm(job.company))) return 'company excluded';
  if (s.locations?.length) {
    const loc = job.location || '';
    const locOk = s.locations.some((l) => matchTerm(loc, l));
    const remoteOk = s.remote_ok && (job.remote === 1 || /\b(remote|anywhere|worldwide)\b/i.test(loc));
    if (!locOk && !remoteOk) return 'location';
  }
  if (s.max_age_days && job.posted_at && job.posted_at < daysAgo(s.max_age_days)) return 'older than max_age_days';
  if (s.must_have_any?.length && job.description && !s.must_have_any.some((k) => matchTerm(job.description, k))) return 'no must_have_any keyword';
  return null;
}

// ---------------------------------------------------------------- fetch
function seedBoards(cfg) {
  const d = open();
  const ins = d.prepare(`INSERT INTO boards (ats, token, company, added_by, added_at) VALUES (?, ?, ?, 'config', ?)
    ON CONFLICT(ats, token) DO UPDATE SET company = COALESCE(excluded.company, boards.company)`);
  for (const ats of Object.keys(BOARD_SOURCES)) {
    for (const entry of cfg.sources[ats] || []) {
      const token = typeof entry === 'string' ? entry : entry.token;
      if (token) ins.run(ats, token, typeof entry === 'string' ? null : entry.company || null, now());
    }
  }
}

function ingest(jobs, ctx, cfg, counts) {
  const d = open();
  const t = now();
  const findUid = d.prepare('SELECT id FROM jobs WHERE uid = ?');
  const touch = d.prepare('UPDATE jobs SET seen_at = ? WHERE id = ?');
  const findFp = d.prepare('SELECT id FROM jobs WHERE fp = ? AND fetched_at >= ? LIMIT 1');
  const insert = d.prepare(`INSERT INTO jobs (uid, fp, source, ats, board, company, title, location, remote, salary, url, apply_url,
    description, posted_at, fetched_at, seen_at, updated_at, status, reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const since = daysAgo(60);
  d.exec('BEGIN');
  try {
    for (const j of jobs) {
      if (!j.title || !j.uid) continue;
      if (ctx.company) j.company = ctx.company;
      const hit = findUid.get(j.uid);
      if (hit) { touch.run(t, hit.id); counts.seen++; continue; }
      const fp = fpOf(j);
      if (findFp.get(fp, since)) { counts.dup++; continue; }
      const reason = prefilter(j, cfg.search);
      insert.run(j.uid, fp, ctx.source, ctx.ats || detectAts(j.apply_url || j.url), ctx.board || null, j.company || '', j.title,
        j.location || '', j.remote ?? null, j.salary || null, j.url || null, j.apply_url || j.url || null,
        reason ? null : (j.description || '').slice(0, 20000), j.posted_at || null, t, t, t,
        reason ? 'filtered' : 'new', reason);
      counts[reason ? 'filtered' : 'new']++;
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

function closeMissing(source, board, liveUids) {
  const d = open();
  const rows = d.prepare(`SELECT id, uid FROM jobs WHERE source = ? AND board = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`)
    .all(source, board, ...OPEN_STATUSES);
  let closed = 0;
  for (const r of rows) if (!liveUids.has(r.uid)) { setStatus(r.id, 'closed', {}, 'posting no longer on the company board'); closed++; }
  return closed;
}

async function pool(tasks, size) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; results[k] = await tasks[k](); }
  }));
  return results;
}

async function cmdFetch(opt) {
  const cfg = loadConfig();
  const d = open();
  seedBoards(cfg);
  const only = opt.source;
  const tasks = [];
  const summary = [];
  for (const b of d.prepare('SELECT * FROM boards WHERE enabled = 1').all()) {
    if (only && only !== b.ats) continue;
    tasks.push(async () => {
      const counts = { source: `${b.ats}:${b.token}`, new: 0, filtered: 0, dup: 0, seen: 0, closed: 0 };
      try {
        const src = BOARD_SOURCES[b.ats];
        const jobs = await src.fetch(b.token, cfg);
        if (!opt['dry-run']) {
          ingest(jobs, { source: b.ats, ats: b.ats, board: b.token, company: b.company }, cfg, counts);
          if (src.full) counts.closed = closeMissing(b.ats, b.token, new Set(jobs.map((j) => j.uid)));
          d.prepare('UPDATE boards SET last_ok = ?, last_error = NULL, fail_count = 0 WHERE ats = ? AND token = ?').run(now(), b.ats, b.token);
        } else counts.fetched = jobs.length;
      } catch (e) {
        counts.error = e.message;
        d.prepare('UPDATE boards SET last_error = ?, fail_count = fail_count + 1 WHERE ats = ? AND token = ?').run(e.message, b.ats, b.token);
      }
      summary.push(counts);
    });
  }
  for (const [name, fn] of Object.entries(FEED_SOURCES)) {
    const sc = cfg.sources[name];
    if (!(sc === true || sc?.enabled) || (only && only !== name)) continue;
    tasks.push(async () => {
      const counts = { source: name, new: 0, filtered: 0, dup: 0, seen: 0 };
      try {
        const jobs = await fn(cfg, typeof sc === 'object' ? sc : {});
        if (!opt['dry-run']) ingest(jobs, { source: name }, cfg, counts);
        else counts.fetched = jobs.length;
      } catch (e) { counts.error = e.message; }
      summary.push(counts);
    });
  }
  if (!tasks.length) fail('no sources configured: add boards or feeds under "sources" in client.jsonc, or `jobsquad boards add`');
  await pool(tasks, 4);
  if (!opt['dry-run']) { meta('last_fetch_at', now()); logEvent(null, 'fetch', JSON.stringify(summary)); }
  const tot = summary.reduce((a, c) => ({ new: a.new + c.new, filtered: a.filtered + c.filtered, dup: a.dup + c.dup, errors: a.errors + (c.error ? 1 : 0) }), { new: 0, filtered: 0, dup: 0, errors: 0 });
  if (opt.json) return out({ total: tot, sources: summary }, true);
  console.log(`fetch: ${tot.new} new for scoring, ${tot.filtered} filtered out, ${tot.dup} duplicates, ${tot.errors} source errors`);
  if (!opt.quiet) for (const c of summary) console.log(`  ${c.source.padEnd(34)} new ${c.new}  filtered ${c.filtered}  dup ${c.dup}${c.closed ? `  closed ${c.closed}` : ''}${c.error ? `  ERROR ${short(c.error, 80)}` : ''}`);
}

// ---------------------------------------------------------------- views
function table(rows) {
  if (!rows.length) return '(none)';
  return rows.map((j) => [
    `#${j.id}`.padEnd(6), String(j.score ?? '–').padStart(3), (j.status || '').padEnd(12),
    short(j.company, 22).padEnd(22), short(j.title, 46).padEnd(46), short(j.location, 26).padEnd(26), j.ats || '',
  ].join(' ')).join('\n');
}

function cmdList(opt) {
  const d = open();
  const statuses = (opt.status || 'new,shortlisted,approved,drafting,ready,applying,needs_human').split(',');
  const where = [`status IN (${statuses.map(() => '?').join(',')})`];
  const args = [...statuses];
  if (opt.since) { where.push('updated_at >= ?'); args.push(daysAgo(Number(opt.since))); }
  if (opt['min-score']) { where.push('score >= ?'); args.push(Number(opt['min-score'])); }
  if (opt.company) { where.push('lower(company) LIKE ?'); args.push(`%${opt.company.toLowerCase()}%`); }
  const rows = d.prepare(`SELECT id, score, status, company, title, location, ats, salary, url, apply_url, reason, posted_at, applied_at
    FROM jobs WHERE ${where.join(' AND ')} ORDER BY score IS NULL, score DESC, id DESC LIMIT ?`).all(...args, Number(opt.limit || 50));
  out(opt.json ? rows : table(rows), opt.json);
}

function cmdShow(id, opt) {
  const j = getJob(id);
  if (opt.json) return out(j, true);
  const desc = j.description || '(no description stored; open the URL)';
  console.log(`#${j.id} ${j.title} — ${j.company}
status: ${j.status}   score: ${j.score ?? '–'}   ats: ${j.ats}   source: ${j.source}${j.board ? ` (${j.board})` : ''}
location: ${j.location || '–'}${j.remote ? ' (remote)' : ''}   salary: ${j.salary || '–'}   posted: ${(j.posted_at || '').slice(0, 10)}
url: ${j.url}
apply: ${j.apply_url}
reason: ${j.reason || '–'}${j.notes ? `\nnotes:\n${j.notes}` : ''}

${opt.full ? desc : short(desc, 6000)}`);
}

function cmdLog(id) {
  const rows = open().prepare('SELECT at, actor, event, detail FROM events WHERE job_id = ? ORDER BY id').all(Number(id));
  console.log(rows.map((r) => `${r.at.slice(0, 16)}  ${r.actor.padEnd(12)} ${r.event.padEnd(12)} ${r.detail || ''}`).join('\n') || '(no events)');
}

// ---------------------------------------------------------------- decisions
function cmdScore(id, score, opt) {
  const cfg = loadConfig();
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0 || n > 100) fail('score must be 0–100');
  if (!opt.reason) fail('--reason "<why, ≤140 chars>" is required');
  const j = getJob(id);
  open().prepare('UPDATE jobs SET score = ?, reason = ?, updated_at = ? WHERE id = ?').run(n, short(opt.reason, 200), now(), j.id);
  if (['new', 'filtered', 'screened_out', 'shortlisted'].includes(j.status)) {
    setStatus(j.id, n >= cfg.limits.min_score_to_shortlist ? 'shortlisted' : 'screened_out', {}, `score ${n}: ${short(opt.reason, 120)}`);
  } else logEvent(j.id, 'scored', `${n}: ${opt.reason}`);
  console.log(`#${j.id} → ${getJob(j.id).status} (${n})`);
}

function cmdApprove(list, opt) {
  if (!opt.msg) fail('--msg "<the client\'s message, quoted>" is required so every approval is traceable to the client');
  for (const id of ids(list)) {
    const j = getJob(id);
    if (['applied', 'applying', 'interview', 'offer'].includes(j.status)) { console.log(`#${id} already ${j.status}, skipped`); continue; }
    setStatus(id, 'approved', {}, `client: "${short(opt.msg, 160)}"`);
    console.log(`#${id} approved — ${j.title} @ ${j.company}`);
  }
}

function cmdSkip(list, opt) {
  for (const id of ids(list)) {
    setStatus(id, 'skipped', {}, opt.note ? `client: ${opt.note}` : 'client skipped');
    console.log(`#${id} skipped`);
  }
}

const SET_FORBIDDEN = { approved: 'use `jobsquad approve <ids> --msg ...`', applied: 'use `jobsquad applied <id> --evidence <file>`', needs_human: 'use `jobsquad needs-human <id> --reason ...`' };
function cmdSet(id, status, opt) {
  if (SET_FORBIDDEN[status]) fail(SET_FORBIDDEN[status]);
  const j = getJob(id);
  if (status === 'ready' && !j.qa_passed) fail('QA has not passed; run `jobsquad qa <id>` first');
  setStatus(id, status, {}, opt.note);
  console.log(`#${id} → ${status}`);
}

function cmdAdd(opt) {
  if (!opt.url) fail('--url is required');
  if (!opt.title || !opt.company) fail('--title and --company are required');
  const d = open();
  const uid = `manual:${crypto.createHash('sha1').update(opt.url).digest('hex').slice(0, 12)}`;
  const existing = d.prepare('SELECT id FROM jobs WHERE uid = ?').get(uid);
  if (existing) { console.log(`already tracked as #${existing.id}`); return; }
  const desc = opt['description-file'] ? fs.readFileSync(opt['description-file'], 'utf8').slice(0, 20000) : null;
  const j = { company: opt.company, title: opt.title, location: opt.location || '' };
  const t = now();
  const r = d.prepare(`INSERT INTO jobs (uid, fp, source, ats, company, title, location, url, apply_url, description, fetched_at, seen_at, updated_at, status, reason)
    VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'added by hand')`)
    .run(uid, fpOf(j), detectAts(opt.url), j.company, j.title, j.location, opt.url, opt.url, desc, t, t, t);
  const id = Number(r.lastInsertRowid);
  logEvent(id, 'added', opt.url);
  if (opt.approved) cmdApprove([String(id)], opt);
  console.log(`added #${id} (${detectAts(opt.url)})`);
}

function cmdBoards(sub, args, opt) {
  const d = open();
  seedBoards(loadConfig());
  if (!sub || sub === 'list') {
    const rows = d.prepare('SELECT * FROM boards ORDER BY ats, token').all();
    if (opt.json) return out(rows, true);
    return console.log(rows.map((b) => `${b.enabled ? ' ' : 'x'} ${b.ats.padEnd(16)} ${b.token.padEnd(28)} ${short(b.company || '', 24).padEnd(24)} ${b.last_error ? `ERR×${b.fail_count} ${short(b.last_error, 50)}` : (b.last_ok || 'never fetched').slice(0, 16)}`).join('\n') || '(no boards)');
  }
  const [ats, token] = args;
  if (!BOARD_SOURCES[ats] || !token) fail(`usage: jobsquad boards ${sub} <${Object.keys(BOARD_SOURCES).join('|')}> <token> [--company "Name"]`);
  if (sub === 'add') {
    d.prepare(`INSERT INTO boards (ats, token, company, added_by, added_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(ats, token) DO UPDATE SET enabled = 1, company = COALESCE(excluded.company, boards.company)`)
      .run(ats, token, opt.company || null, process.env.JOBSQUAD_ACTOR || 'cli', now());
    console.log(`board ${ats}:${token} added`);
  } else if (sub === 'remove' || sub === 'disable') {
    d.prepare('UPDATE boards SET enabled = 0 WHERE ats = ? AND token = ?').run(ats, token);
    console.log(`board ${ats}:${token} disabled`);
  } else fail('boards subcommands: list | add | remove');
}

// ---------------------------------------------------------------- application package
function cmdPrepare(id) {
  const j = getJob(id);
  const dir = appDir(j.id);
  fs.mkdirSync(path.join(dir, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.md'), `# ${j.title} — ${j.company}

- Job id: #${j.id}
- Location: ${j.location || '–'}${j.remote ? ' (remote)' : ''}
- Salary: ${j.salary || '–'}
- ATS: ${j.ats}
- Posting: ${j.url}
- Apply: ${j.apply_url}
- Match score: ${j.score ?? '–'} — ${j.reason || ''}

## Description

${j.description || '(not stored: open the posting URL and read it)'}
`);
  if (!['drafting', 'ready', 'applying', 'applied'].includes(j.status)) setStatus(j.id, 'drafting');
  open().prepare('UPDATE jobs SET qa_passed = 0 WHERE id = ?').run(j.id);
  const cfg = loadConfig();
  console.log(`${dir}
write: ${cfg.writing.resume_strategy === 'tailored' ? 'resume.md, ' : ''}${cfg.writing.cover_letter ? 'cover_letter.md, ' : ''}answers.md
then: jobsquad qa ${j.id} && jobsquad render ${j.id} && jobsquad set ${j.id} ready`);
}

function cmdQa(id, opt) {
  const j = getJob(id);
  const r = runQa(j);
  open().prepare('UPDATE jobs SET qa_passed = ?, updated_at = ? WHERE id = ?').run(r.pass ? 1 : 0, now(), j.id);
  logEvent(j.id, r.pass ? 'qa_pass' : 'qa_fail', [...r.failures, ...r.warnings].join(' | ') || null);
  if (opt.json) out(r, true);
  else {
    console.log(`QA #${j.id}: ${r.pass ? 'PASS' : 'FAIL'}`);
    for (const f of r.failures) console.log(`  ✗ ${f}`);
    for (const w of r.warnings) console.log(`  ! ${w}`);
  }
  if (!r.pass) process.exit(1);
}

function fileBase() {
  const a = loadAnswers();
  const cfg = loadConfig();
  const name = [a.identity?.first_name, a.identity?.last_name].filter(Boolean).join(' ') || cfg.client?.name || 'Candidate';
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function cmdRender(id) {
  const j = getJob(id);
  const dir = appDir(j.id);
  const base = fileBase();
  const made = [];
  for (const [md, kind, label] of [['resume.md', 'resume', 'Resume'], ['cover_letter.md', 'letter', 'Cover_Letter']]) {
    const src = path.join(dir, md);
    if (!fs.existsSync(src)) continue;
    const html = path.join(dir, `${base}_${label}.html`);
    const pdf = path.join(dir, `${base}_${label}.pdf`);
    fs.writeFileSync(html, toHtml(fs.readFileSync(src, 'utf8'), `${base} ${label}`, kind));
    fs.rmSync(pdf, { force: true });
    const r = htmlToPdf(html, pdf);
    made.push(r.ok ? pdf : `${html} (PDF failed: ${r.error})`);
  }
  if (!made.length) fail(`nothing to render in ${dir}`);
  logEvent(j.id, 'rendered', made.join(', '));
  console.log(made.join('\n'));
}

function uploadsRoot() {
  if (process.env.OPENCLAW_UPLOADS_DIR) return process.env.OPENCLAW_UPLOADS_DIR;
  if (process.platform !== 'win32' && fs.existsSync('/tmp')) return '/tmp/openclaw/uploads';
  return path.join(os.tmpdir(), 'openclaw', 'uploads');
}

function cmdStageUpload(id, opt) {
  const j = getJob(id);
  const cfg = loadConfig();
  const dir = appDir(j.id);
  const base = fileBase();
  const root = uploadsRoot();
  fs.mkdirSync(root, { recursive: true });
  const pick = (f) => (fs.existsSync(f) ? f : null);
  const resume = cfg.writing.resume_strategy === 'tailored' ? pick(path.join(dir, `${base}_Resume.pdf`)) : pick(paths.originalResume);
  const letter = pick(path.join(dir, `${base}_Cover_Letter.pdf`));
  if (!resume) fail('no resume PDF to upload: run `jobsquad render <id>` (or add client/resume.pdf for strategy "original")');
  const staged = {};
  for (const [k, f] of [['resume', resume], ['cover_letter', letter]]) {
    if (!f) { staged[k] = null; continue; }
    const target = path.join(root, k === 'resume' ? `${base}_Resume.pdf` : `${base}_Cover_Letter.pdf`);
    fs.copyFileSync(f, target);
    staged[k] = target;
  }
  out(opt.json ? staged : Object.entries(staged).map(([k, v]) => `${k}: ${v || '(none)'}`).join('\n'), opt.json);
}

function cmdCanApply(id, opt) {
  const r = canApply(getJob(id));
  logEvent(r.id, r.allow ? 'gate_allow' : 'gate_deny', r.allow ? r.action : r.reasons.join(' | '));
  if (opt.json) out(r, true);
  else {
    console.log(`#${r.id}: ${r.allow ? `ALLOW (${r.action})` : 'DENY'}  mode=${r.mode} ats=${r.ats}`);
    for (const x of r.reasons) console.log(`  ✗ ${x}`);
    for (const w of r.warnings) console.log(`  ! ${w}`);
  }
  if (!r.allow) process.exit(2);
}

function keepEvidence(jobId, file) {
  if (!file) return null;
  if (!fs.existsSync(file)) fail(`evidence file not found: ${file}`);
  const dest = path.join(appDir(jobId), 'evidence', `${Date.now()}-${path.basename(file)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  return dest;
}

function cmdApplied(id, opt) {
  const cfg = loadConfig();
  const j = getJob(id);
  if (!['applying', 'ready', 'needs_human'].includes(j.status)) fail(`#${id} is "${j.status}"; expected applying/ready/needs_human`);
  if (!hasEvent(j.id, 'gate_allow') && !opt.manual) fail('no passing `jobsquad can-apply` on record for this job');
  const ev = keepEvidence(j.id, opt.evidence);
  const follow = new Date(Date.now() + cfg.limits.follow_up_after_days * 864e5).toISOString();
  setStatus(j.id, 'applied', { applied_at: now(), follow_up_at: follow, evidence: ev || j.evidence }, opt.note || (opt.manual ? 'client applied manually' : null));
  console.log(`#${id} applied — follow-up due ${follow.slice(0, 10)}`);
}

function cmdNeedsHuman(id, opt) {
  if (!opt.reason) fail('--reason is required (what exactly the client must do)');
  const j = getJob(id);
  const ev = keepEvidence(j.id, opt.evidence);
  setStatus(j.id, 'needs_human', { evidence: ev || j.evidence }, opt.reason);
  console.log(`#${id} → needs_human: ${opt.reason}`);
}

function cmdFollowup(id, opt) {
  const days = Number(opt.days || 7);
  const at = new Date(Date.now() + days * 864e5).toISOString();
  open().prepare('UPDATE jobs SET follow_up_at = ?, updated_at = ? WHERE id = ?').run(at, now(), getJob(id).id);
  logEvent(Number(id), 'follow_up_set', at.slice(0, 10));
  console.log(`#${id} next follow-up ${at.slice(0, 10)}`);
}

function cmdFollowups(opt) {
  const cfg = loadConfig();
  const d = open();
  const due = d.prepare("SELECT id, company, title, applied_at, follow_up_at, apply_url FROM jobs WHERE status = 'applied' AND follow_up_at <= ? ORDER BY follow_up_at").all(now());
  const ghost = d.prepare("SELECT id, company, title, applied_at FROM jobs WHERE status = 'applied' AND applied_at <= ?").all(daysAgo(cfg.limits.ghost_after_days));
  if (opt.json) return out({ due, ghost_candidates: ghost }, true);
  console.log(`follow-ups due: ${due.length}`);
  for (const r of due) console.log(`  #${r.id} ${r.title} @ ${r.company} (applied ${r.applied_at.slice(0, 10)})`);
  console.log(`no reply after ${cfg.limits.ghost_after_days} days: ${ghost.length}`);
  for (const r of ghost) console.log(`  #${r.id} ${r.title} @ ${r.company} (applied ${r.applied_at.slice(0, 10)})`);
}

// ---------------------------------------------------------------- reporting
function cmdDigest(opt) {
  const cfg = loadConfig();
  const d = open();
  const last = meta('last_digest_at') || daysAgo(1);
  const fresh = d.prepare("SELECT * FROM jobs WHERE status = 'shortlisted' AND updated_at > ? ORDER BY score DESC LIMIT ?").all(last, cfg.limits.max_digest_items);
  const waiting = d.prepare("SELECT id FROM jobs WHERE status = 'shortlisted' AND updated_at <= ? ORDER BY score DESC").all(last);
  const applied = d.prepare('SELECT id, company, title FROM jobs WHERE applied_at > ? ORDER BY applied_at').all(last);
  const human = d.prepare("SELECT id, company, title, apply_url, notes FROM jobs WHERE status = 'needs_human' ORDER BY updated_at").all();
  const due = d.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'applied' AND follow_up_at <= ?").get(now()).n;
  const lines = [];
  const day = new Date().toLocaleDateString(cfg.client?.language || 'en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: cfg.client?.timezone || undefined });
  lines.push(`JobSquad · ${day} · mode: ${cfg.mode}${cfg.paused ? ' (PAUSED)' : ''}`);
  if (fresh.length) {
    lines.push('', `New matches (${fresh.length}):`);
    for (const j of fresh) {
      lines.push(`#${j.id} · ${j.score} · ${j.title} — ${j.company}`);
      lines.push(`   ${[j.location, j.salary].filter(Boolean).join(' · ')}`);
      if (j.reason) lines.push(`   ${short(j.reason, 140)}`);
      lines.push(`   ${j.url}`);
    }
  } else lines.push('', 'No new matches since the last update.');
  if (waiting.length) lines.push('', `Still waiting for your answer: ${waiting.map((r) => `#${r.id}`).join(' ')}`);
  if (applied.length) lines.push('', `Applied (${applied.length}): ${applied.map((r) => `#${r.id} ${r.company}`).join(', ')}`);
  if (human.length) {
    lines.push('', `Needs you (${human.length}):`);
    for (const r of human) lines.push(`#${r.id} ${r.company}: ${short((r.notes || '').split('\n').pop().replace(/^\[[^\]]+\]\s*/, ''), 120)}\n   ${r.apply_url}`);
  }
  if (due) lines.push('', `Follow-ups due: ${due}`);
  if (fresh.length || waiting.length) lines.push('', 'Reply "approve 12 15", "skip 13", or ask about any #id.');
  if (!opt['no-mark']) meta('last_digest_at', now());
  console.log(lines.join('\n'));
}

function cmdStats(opt) {
  const d = open();
  const days = Number(opt.days || 7);
  const since = daysAgo(days);
  const byStatus = Object.fromEntries(d.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all().map((r) => [r.status, r.n]));
  const window = {
    fetched: d.prepare('SELECT COUNT(*) AS n FROM jobs WHERE fetched_at >= ?').get(since).n,
    passed_filter: d.prepare("SELECT COUNT(*) AS n FROM jobs WHERE fetched_at >= ? AND status != 'filtered'").get(since).n,
    shortlisted: d.prepare("SELECT COUNT(DISTINCT job_id) AS n FROM events WHERE event = 'shortlisted' AND at >= ?").get(since).n,
    approved: d.prepare("SELECT COUNT(DISTINCT job_id) AS n FROM events WHERE event = 'approved' AND at >= ?").get(since).n,
    applied: d.prepare('SELECT COUNT(*) AS n FROM jobs WHERE applied_at >= ?').get(since).n,
    interviews: d.prepare("SELECT COUNT(DISTINCT job_id) AS n FROM events WHERE event = 'interview' AND at >= ?").get(since).n,
    needs_human: byStatus.needs_human || 0,
  };
  const filterReasons = d.prepare("SELECT reason, COUNT(*) AS n FROM jobs WHERE status = 'filtered' AND fetched_at >= ? GROUP BY reason ORDER BY n DESC LIMIT 6").all(since);
  const skipNotes = d.prepare("SELECT detail FROM events WHERE event = 'skipped' AND at >= ? AND detail IS NOT NULL").all(since).map((r) => r.detail);
  const brokenBoards = d.prepare('SELECT ats, token, fail_count, last_error FROM boards WHERE enabled = 1 AND fail_count >= 3').all();
  const r = { days, last_fetch_at: meta('last_fetch_at'), window, by_status: byStatus, filter_reasons: filterReasons, skip_notes: skipNotes, broken_boards: brokenBoards };
  if (opt.json) return out(r, true);
  console.log(`last ${days} days: fetched ${window.fetched} → passed filter ${window.passed_filter} → shortlisted ${window.shortlisted} → approved ${window.approved} → applied ${window.applied} → interviews ${window.interviews}`);
  console.log(`last fetch: ${r.last_fetch_at || 'never'}   needs_human now: ${window.needs_human}`);
  console.log(`all-time by status: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (filterReasons.length) console.log(`top filter reasons: ${filterReasons.map((f) => `${f.reason} (${f.n})`).join('; ')}`);
  if (skipNotes.length) console.log(`client skip notes: ${skipNotes.map((s) => short(s, 60)).join(' | ')}`);
  if (brokenBoards.length) console.log(`boards failing 3+ times: ${brokenBoards.map((b) => `${b.ats}:${b.token}`).join(', ')}`);
}

function cmdExport(opt) {
  const rows = open().prepare("SELECT id, status, score, company, title, location, salary, ats, url, applied_at, reason FROM jobs WHERE status != 'filtered' ORDER BY id").all();
  const cols = ['id', 'status', 'score', 'company', 'title', 'location', 'salary', 'ats', 'url', 'applied_at', 'reason'];
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const file = typeof opt.csv === 'string' ? opt.csv : path.join(paths.reports, `jobs-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, csv);
  console.log(`${rows.length} rows → ${file}`);
}

// ---------------------------------------------------------------- doctor
function cmdDoctor(opt) {
  const checks = [];
  const add = (ok, label, hint = '', critical = true) => checks.push({ ok, label, hint, critical });
  const [maj, min] = process.versions.node.split('.').map(Number);
  add(maj > 22 || (maj === 22 && min >= 13), `node ${process.versions.node} with node:sqlite`, 'needs Node 22.13+ (OpenClaw ships 24+)');
  add(fs.existsSync(paths.config), `client settings ${paths.config}`, 'copy client-template/client.jsonc');
  let cfg;
  try { cfg = loadConfig(); add(true, 'client.jsonc parses'); } catch (e) { add(false, 'client.jsonc parses', e.message); }
  if (cfg) {
    add(!!cfg.client?.name && !/REPLACE/i.test(cfg.client.name), 'client.name set', 'fill client.name');
    add(cfg.search.titles?.length > 0, `target titles (${(cfg.search.titles || []).join(', ') || 'none'})`, 'fill search.titles');
    add(['review', 'assist', 'auto'].includes(cfg.mode), `mode "${cfg.mode}"`, 'review | assist | auto');
    const nBoards = Object.keys(BOARD_SOURCES).reduce((n, k) => n + (cfg.sources[k]?.length || 0), 0);
    const nFeeds = Object.keys(FEED_SOURCES).filter((k) => cfg.sources[k] === true || cfg.sources[k]?.enabled).length;
    add(nBoards + nFeeds > 0, `${nBoards} company boards, ${nFeeds} feeds configured`, 'add sources in client.jsonc', false);
  }
  const master = fs.existsSync(paths.masterResume) ? fs.readFileSync(paths.masterResume, 'utf8') : '';
  add(master.trim().length > 200 && !/REPLACE ME/.test(master), 'master_resume.md filled in', 'paste the full, honest résumé into client/master_resume.md');
  try {
    const a = readJsonc(paths.answers);
    add(!!a.identity?.email && !/REPLACE|example\.com/i.test(a.identity.email), 'answers.jsonc identity filled', 'fill identity.* in answers.jsonc');
    add(!!a.work_authorization, 'answers.jsonc work authorization filled', 'fill work_authorization');
  } catch (e) { add(false, 'answers.jsonc parses', e.message); }
  add(fs.existsSync(paths.originalResume), 'client/resume.pdf present (fallback + reference)', 'optional', false);
  const chrome = findChrome();
  add(!!chrome, `PDF renderer: ${chrome || 'not found'}`, 'install Google Chrome or set CHROME_PATH');
  try { open().prepare('SELECT 1').get(); add(true, `database ${paths.db}`); } catch (e) { add(false, 'database', e.message); }
  try { const r = uploadsRoot(); fs.mkdirSync(r, { recursive: true }); fs.accessSync(r, fs.constants.W_OK); add(true, `browser uploads dir ${r}`); } catch (e) { add(false, 'browser uploads dir writable', e.message); }
  if (opt.json) return out(checks, true);
  for (const c of checks) console.log(`${c.ok ? '✓' : c.critical ? '✗' : '!'} ${c.label}${c.ok ? '' : ` — ${c.hint}`}`);
  if (checks.some((c) => !c.ok && c.critical)) process.exit(1);
}

const HELP = `jobsquad ${VERSION} — job-search tracker and guardrails for OpenClaw agents
home: ${HOME}

Setup        init | doctor
Find         fetch [--source <ats|feed>] [--dry-run] [--quiet]
             boards [list | add <ats> <token> --company "Name" | remove <ats> <token>]
             add --url <url> --title "..." --company "..." [--location ..] [--description-file f] [--approved --msg "..."]
Review       list [--status a,b] [--since days] [--min-score n] [--company x] [--limit n] [--json]
             show <id> [--full] [--json]      log <id>
             score <id> <0-100> --reason "..."
             approve <ids> --msg "<client's words>"      skip <ids> [--note "why"]
Prepare      prepare <id>  →  write resume.md / cover_letter.md / answers.md in the printed folder
             qa <id>      render <id>      set <id> ready
Apply        can-apply <id> [--json]     (exit 2 = deny; never apply without ALLOW)
             stage-upload <id>      set <id> applying
             applied <id> --evidence <screenshot> [--note ..]      needs-human <id> --reason "..." [--evidence f]
After        followups      followup <id> --days n      set <id> interview|offer|rejected|withdrawn|ghosted [--note ..]
Report       digest [--no-mark]      stats [--days n]      export [--csv file]

Statuses: ${STATUSES.join(', ')}`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const need = (n, usage) => { if (pos.length < n) fail(`usage: jobsquad ${usage}`); };
  switch (cmd) {
    case undefined: case 'help': case '--help': case '-h': return console.log(HELP);
    case 'version': case '--version': return console.log(VERSION);
    case 'init': for (const p of [paths.client, paths.data, paths.apps, paths.reports]) fs.mkdirSync(p, { recursive: true }); open(); return console.log(`ready: ${HOME}`);
    case 'doctor': return cmdDoctor(opt);
    case 'fetch': return cmdFetch(opt);
    case 'boards': return cmdBoards(pos[0], pos.slice(1), opt);
    case 'add': return cmdAdd(opt);
    case 'list': return cmdList(opt);
    case 'show': need(1, 'show <id>'); return cmdShow(pos[0], opt);
    case 'log': need(1, 'log <id>'); return cmdLog(pos[0]);
    case 'score': need(2, 'score <id> <0-100> --reason "..."'); return cmdScore(pos[0], pos[1], opt);
    case 'approve': need(1, 'approve <ids> --msg "..."'); return cmdApprove(pos, opt);
    case 'skip': need(1, 'skip <ids> [--note ..]'); return cmdSkip(pos, opt);
    case 'set': need(2, 'set <id> <status> [--note ..]'); return cmdSet(pos[0], pos[1], opt);
    case 'note': need(2, 'note <id> "text"'); appendNote(pos[0], pos.slice(1).join(' ')); return console.log('noted');
    case 'prepare': need(1, 'prepare <id>'); return cmdPrepare(pos[0]);
    case 'qa': need(1, 'qa <id>'); return cmdQa(pos[0], opt);
    case 'render': need(1, 'render <id>'); return cmdRender(pos[0]);
    case 'stage-upload': need(1, 'stage-upload <id>'); return cmdStageUpload(pos[0], opt);
    case 'can-apply': need(1, 'can-apply <id>'); return cmdCanApply(pos[0], opt);
    case 'applied': need(1, 'applied <id> --evidence <file>'); return cmdApplied(pos[0], opt);
    case 'needs-human': need(1, 'needs-human <id> --reason ".."'); return cmdNeedsHuman(pos[0], opt);
    case 'followup': need(1, 'followup <id> --days n'); return cmdFollowup(pos[0], opt);
    case 'followups': return cmdFollowups(opt);
    case 'digest': return cmdDigest(opt);
    case 'stats': return cmdStats(opt);
    case 'export': return cmdExport(opt);
    default: fail(`unknown command "${cmd}". Run: jobsquad help`);
  }
}

main().catch((e) => fail(e.message));
