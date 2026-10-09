#!/usr/bin/env node
// JobSquad installer: one cross-platform implementation behind install.sh and install.ps1.
// Idempotent: safe to re-run for upgrades. Never overwrites client data in <home>/client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as wiz from './wizard.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';

const AGENTS = {
  'job-chief': {
    description: 'JobSquad lead: talks to the client, delegates, enforces apply rules',
    identity: { name: 'JobSquad Chief', emoji: '🧭' },
    subagents: { allowAgents: ['job-scout', 'job-matcher', 'job-writer', 'job-applier', 'job-tracker'], delegationMode: 'prefer' },
    tools: { deny: ['browser', 'gateway'] },
    skills: [],
  },
  'job-scout': {
    description: 'JobSquad: finds postings and company job boards',
    identity: { name: 'JobSquad Scout', emoji: '🔭' },
    tools: { deny: ['browser', 'gateway', 'message'] },
    skills: [], fast: true,
  },
  'job-matcher': {
    description: 'JobSquad: scores postings against the client profile',
    identity: { name: 'JobSquad Matcher', emoji: '🎯' },
    tools: { deny: ['browser', 'gateway', 'message'] },
    skills: ['job-scoring'], fast: true,
  },
  'job-writer': {
    description: 'JobSquad: tailors resume, cover letter and answers (truth-locked)',
    identity: { name: 'JobSquad Writer', emoji: '✍️' },
    tools: { deny: ['browser', 'gateway', 'message'] },
    skills: ['resume-tailor'],
  },
  'job-applier': {
    description: 'JobSquad: fills and submits one approved application in the browser',
    identity: { name: 'JobSquad Applier', emoji: '📮' },
    tools: { deny: ['gateway', 'message'] },
    skills: ['ats-apply'],
  },
  'job-tracker': {
    description: 'JobSquad: follow-ups, status hygiene, weekly report',
    identity: { name: 'JobSquad Tracker', emoji: '📈' },
    tools: { deny: ['browser', 'gateway', 'message'] },
    skills: [], fast: true,
  },
};
const STEPS = ['preflight', 'files', 'agents', 'config', 'approvals', 'bind', 'schedule', 'doctor'];

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o[k] = argv[++i];
    else o[k] = true;
  }
  return o;
}
const opt = parseArgs(process.argv.slice(2));
if (opt.help) {
  console.log(`JobSquad installer

  --wizard                         guided setup for beginners (asks plain questions; default for the Mac double-click installer)
  --client-name "Jane Doe"         client's full name (first install)
  --timezone Europe/Istanbul       default: this computer's timezone
  --language en                    language the Chief writes in
  --resume path/to/resume.pdf      copied to <home>/client/resume.pdf
  --master-resume path/to/cv.md    copied to <home>/client/master_resume.md
  --home <dir>                     data folder (default ~/jobsquad)
  --bind <channel[:account]>       route the client's chat to job-chief, e.g. telegram:*
  --deliver-channel <channel>      where scheduled digests go, e.g. telegram
  --deliver-to <target>            chat id / target for digests
  --model <provider/model>         model for all JobSquad agents (default: your OpenClaw default)
  --fast-model <provider/model>    cheaper model for scout, matcher, tracker
  --profile <name>                 OpenClaw profile (isolated state, e.g. for testing)
  --only <step[,step]>             ${STEPS.join(', ')}
  --skip-schedule                  don't create automations
  --dry-run                        print OpenClaw commands instead of running them
  --uninstall [--purge]            remove agents and automations (--purge also deletes <home>)
  --yes                            don't ask for confirmation`);
  process.exit(0);
}

const HOME = path.resolve(opt.home || process.env.JOBSQUAD_HOME || path.join(os.homedir(), 'jobsquad'));
const BIN = path.join(HOME, 'bin', WIN ? 'jobsquad.cmd' : 'jobsquad');
const only = opt.only ? String(opt.only).split(',') : null;
const runStep = (s) => (!only || only.includes(s)) && !(s === 'schedule' && opt['skip-schedule']);
const say = (m) => console.log(m);
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };

// ---------------------------------------------------------------- openclaw runner
function findOpenclaw() {
  const cands = [process.env.OPENCLAW_BIN, 'openclaw', path.join(os.homedir(), '.openclaw', 'bin', WIN ? 'openclaw.cmd' : 'openclaw')].filter(Boolean);
  for (const c of cands) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf8', shell: WIN, timeout: 120_000 });
    if (r.status === 0 && /OpenClaw/i.test(r.stdout)) return { bin: c, version: r.stdout.trim().split('\n')[0] };
  }
  return null;
}
let OC;
const winQuote = (a) => (/^[\w.:/\\=@*,-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);

function oc(args, { allowFail = false, capture = false, inherit = false } = {}) {
  const full = [...(opt.profile ? ['--profile', opt.profile] : []), ...args];
  if (opt['dry-run']) { say(`    $ openclaw ${full.map(winQuote).join(' ')}`); return { status: 0, stdout: '' }; }
  const r = WIN
    ? spawnSync(`${winQuote(OC.bin)} ${full.map(winQuote).join(' ')}`, { encoding: 'utf8', shell: true, timeout: inherit ? 0 : 180_000, stdio: inherit ? 'inherit' : 'pipe' })
    : spawnSync(OC.bin, full, { encoding: 'utf8', timeout: inherit ? 0 : 180_000, stdio: inherit ? 'inherit' : 'pipe' });
  if (r.status !== 0 && !allowFail) die(`openclaw ${args.slice(0, 3).join(' ')} failed:\n${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
  if (!capture && r.status === 0 && process.env.JOBSQUAD_VERBOSE) process.stdout.write(r.stdout);
  return r;
}

function ocJson(args) {
  const r = oc([...args, '--json'], { allowFail: true, capture: true });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout.slice(r.stdout.search(/[[{]/))); } catch { return null; }
}

function stateDir() {
  if (opt['dry-run'] && !OC) return path.join(os.homedir(), opt.profile ? `.openclaw-${opt.profile}` : '.openclaw');
  const r = oc(['config', 'file'], { allowFail: true, capture: true });
  const line = (r.stdout || '').trim().split('\n').pop();
  if (r.status === 0 && line && line.endsWith('.json')) return path.dirname(line.replace(/^~/, os.homedir()));
  return path.join(os.homedir(), opt.profile ? `.openclaw-${opt.profile}` : '.openclaw');
}

async function confirm(q) {
  if (opt.yes || !process.stdin.isTTY) return true;
  process.stdout.write(`${q} [y/N] `);
  const ans = await new Promise((res) => process.stdin.once('data', (d) => res(String(d).trim())));
  process.stdin.pause();
  return /^y(es)?$/i.test(ans);
}

// ---------------------------------------------------------------- helpers
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function clientValues() {
  let cfgText = '';
  try { cfgText = fs.readFileSync(path.join(HOME, 'client', 'client.jsonc'), 'utf8'); } catch {}
  const pick = (key) => cfgText.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`))?.[1];
  const name = (pick('name') || opt['client-name'] || 'the client').replace(/^REPLACE\s*/, '') || 'the client';
  return {
    CLIENT_NAME: name,
    CLIENT_FIRST: name.split(/\s+/)[0],
    LANGUAGE: LANGS[pick('language') || opt.language || 'en'] || pick('language') || opt.language || 'English',
    TIMEZONE: pick('timezone') || opt.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    JOBSQUAD_HOME: HOME,
    JOBSQUAD: BIN,
    DATE: new Date().toISOString().slice(0, 10),
  };
}
const LANGS = { en: 'English', tr: 'Turkish (Türkçe)', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese' };
const render = (text, v) => text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => v[k] ?? m);

// ---------------------------------------------------------------- steps
function preflight() {
  say('\n[1/8] Preflight');
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (!(maj > 22 || (maj === 22 && min >= 13))) die(`Node ${process.versions.node} lacks node:sqlite. Use Node 22.13+ (OpenClaw installs Node 24).`);
  ok(`node ${process.versions.node} (${process.execPath})`);
  OC = findOpenclaw();
  if (!OC && !opt['dry-run']) die(`OpenClaw not found. Install it first:
    macOS/Linux:  curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash
    Windows:      iwr -useb https://openclaw.ai/install.ps1 | iex
  then run:       openclaw onboard --install-daemon   (model auth + the client's chat channel)
  Or set OPENCLAW_BIN to the openclaw executable.`);
  if (OC) ok(OC.version);
}

function files() {
  say('\n[2/8] Files');
  for (const d of ['client', 'data', 'applications', 'reports', 'bin']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
  fs.rmSync(path.join(HOME, 'app'), { recursive: true, force: true });
  copyDir(path.join(KIT, 'runtime'), path.join(HOME, 'app'));
  fs.copyFileSync(path.join(KIT, 'VERSION'), path.join(HOME, 'app', 'VERSION'));
  ok(`runtime → ${path.join(HOME, 'app')}`);

  const node = process.execPath;
  const entry = path.join(HOME, 'app', 'jobsquad.mjs');
  if (WIN) {
    fs.writeFileSync(BIN, `@echo off\r\nset "JOBSQUAD_HOME=${HOME}"\r\n"${node}" --no-warnings "${entry}" %*\r\n`);
  } else {
    fs.writeFileSync(BIN, `#!/bin/sh\nexport JOBSQUAD_HOME='${HOME}'\nexec '${node}' --no-warnings '${entry}' "$@"\n`, { mode: 0o755 });
  }
  ok(`command → ${BIN}`);

  const tpl = path.join(KIT, 'client-template');
  for (const f of ['client.jsonc', 'answers.jsonc', 'master_resume.md']) {
    const dst = path.join(HOME, 'client', f);
    if (fs.existsSync(dst)) { ok(`client/${f} kept (existing)`); continue; }
    let text = fs.readFileSync(path.join(tpl, f), 'utf8');
    if (f === 'client.jsonc') {
      if (opt['client-name']) text = text.replace('"REPLACE Jane Doe"', JSON.stringify(opt['client-name']));
      text = text.replace('"Europe/Istanbul"', JSON.stringify(opt.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone));
      if (opt.language) text = text.replace('"language": "en"', `"language": ${JSON.stringify(opt.language)}`);
    }
    if (f === 'answers.jsonc' && opt['client-name']) {
      const [first, ...rest] = opt['client-name'].split(/\s+/);
      text = text.replace('"first_name": "REPLACE"', `"first_name": ${JSON.stringify(first)}`)
        .replace('"last_name": "REPLACE"', `"last_name": ${JSON.stringify(rest.join(' ') || 'REPLACE')}`);
    }
    fs.writeFileSync(dst, text);
    ok(`client/${f} created from template`);
  }
  if (opt.resume) { fs.copyFileSync(opt.resume, path.join(HOME, 'client', 'resume.pdf')); ok('client/resume.pdf copied'); }
  if (opt['master-resume']) { fs.copyFileSync(opt['master-resume'], path.join(HOME, 'client', 'master_resume.md')); ok('client/master_resume.md copied'); }
  const r = spawnSync(BIN, ['init'], { encoding: 'utf8', shell: WIN });
  if (r.status !== 0) die(`jobsquad init failed: ${r.stderr || r.stdout}`);
  ok(r.stdout.trim());
}

function agents() {
  say('\n[3/8] Agents');
  const base = stateDir();
  const existing = new Set((ocJson(['agents', 'list']) || []).map((a) => a.id || a.agentId || a.name).filter(Boolean));
  const v = clientValues();
  for (const [id, def] of Object.entries(AGENTS)) {
    const ws = path.join(base, `workspace-${id}`);
    if (!existing.has(id)) {
      const args = ['agents', 'add', id, '--workspace', ws, '--non-interactive'];
      const model = def.fast && opt['fast-model'] ? opt['fast-model'] : opt.model;
      if (model) args.push('--model', model);
      oc(args);
      ok(`${id} created`);
    } else ok(`${id} exists, refreshing workspace`);
    if (opt['dry-run']) continue;
    fs.mkdirSync(ws, { recursive: true });
    for (const f of ['AGENTS.md', 'SOUL.md', 'IDENTITY.md']) {
      fs.writeFileSync(path.join(ws, f), render(fs.readFileSync(path.join(KIT, 'agents', id, f), 'utf8'), v));
    }
    const user = path.join(ws, 'USER.md');
    const userText = fs.existsSync(user) ? fs.readFileSync(user, 'utf8') : '';
    if (!userText || /Replace the example below|- Prefer \.\.\./.test(userText)) {
      fs.writeFileSync(user, render(fs.readFileSync(path.join(KIT, 'agents', 'USER.md'), 'utf8'), v));
    }
    fs.rmSync(path.join(ws, 'BOOTSTRAP.md'), { force: true });
    for (const s of def.skills) copyDir(path.join(KIT, 'skills', s), path.join(ws, 'skills', s));
  }
}

function config() {
  say('\n[4/8] Config');
  const entries = {};
  for (const [id, def] of Object.entries(AGENTS)) {
    const e = { name: id, description: def.description, identity: def.identity, subagents: def.subagents || { allowAgents: [] }, tools: def.tools };
    const model = def.fast && opt['fast-model'] ? opt['fast-model'] : opt.model;
    if (model) e.model = model;
    entries[id] = e;
  }
  const patch = path.join(os.tmpdir(), `jobsquad-patch-${process.pid}.json`);
  fs.writeFileSync(patch, JSON.stringify({ agents: { entries } }, null, 2));
  oc(['config', 'patch', '--file', patch]);
  fs.rmSync(patch, { force: true });
  oc(['config', 'validate']);
  ok('agents.entries.job-* patched and validated');
}

function approvals() {
  say('\n[5/8] Exec allowlist');
  for (const id of Object.keys(AGENTS)) {
    const r = oc(['approvals', 'allowlist', 'add', '--agent', id, BIN], { allowFail: true, capture: true });
    if (r.status === 0) ok(`${id} may run ${BIN} without prompting`);
    else warn(`${id}: could not add allowlist entry (${(r.stderr || '').trim().split('\n')[0]}). Approve "jobsquad" once per agent, or check your exec policy.`);
  }
}

function bind() {
  say('\n[6/8] Chat routing');
  if (!opt.bind) { warn('no --bind given; job-chief is reachable with `openclaw agent --agent job-chief` and the Control UI. Re-run with --only bind --bind telegram:* to route the client\'s chat.'); return; }
  oc(['agents', 'bind', '--agent', 'job-chief', '--bind', opt.bind]);
  ok(`${opt.bind} → job-chief`);
  const other = (ocJson(['agents', 'bindings']) || []).filter((b) => (b.agentId || b.agent) !== 'job-chief' && JSON.stringify(b).includes(String(opt.bind).split(':')[0]));
  if (other.length) warn(`other agents are also bound to ${opt.bind.split(':')[0]}; check \`openclaw agents bindings\` so the client's chat reaches job-chief`);
}

function schedule() {
  say('\n[7/8] Automations');
  const v = clientValues();
  const list = ocJson(['automations', 'list', '--all']);
  const jobs = Array.isArray(list) ? list : list?.jobs || [];
  for (const j of jobs) if (String(j.name || '').startsWith('jobsquad-')) oc(['automations', 'remove', j.id || j.jobId], { allowFail: true });
  // With a chat channel: fresh session each run, final reply announced to the client's chat.
  // Without one (beginners): run inside job-chief's main session, so the digest shows up in the
  // JobSquad chat window and the client can answer right there.
  const toChat = opt['deliver-channel'] && opt['deliver-to'];
  const route = toChat
    ? ['--session', 'isolated', '--announce', '--channel', opt['deliver-channel'], '--to', opt['deliver-to']]
    : ['--session', 'session:agent:job-chief:main', '--no-deliver'];
  const add = (name, cron, message, timeout) => {
    oc(['automations', 'add', '--name', name, '--cron', cron, '--tz', v.TIMEZONE, '--agent', 'job-chief',
      '--message', message, '--timeout-seconds', String(timeout), ...route]);
    ok(`${name}  ${cron}  (${v.TIMEZONE})${toChat ? ` → ${opt['deliver-channel']}` : ' → JobSquad chat'}`);
  };
  add('jobsquad-daily', '0 8 * * 1-5', 'DAILY_RUN: follow the DAILY_RUN procedure in your AGENTS.md.', 3600);
  add('jobsquad-weekly', '0 17 * * 5', 'WEEKLY: spawn job-tracker with "WEEKLY_REPORT" and send its summary to the client.', 1800);
  if (!toChat) ok('digests appear in the JobSquad chat (Desktop icon / Control UI); add a phone app later with --only schedule --deliver-channel telegram --deliver-to <chat id>');
}

function doctor() {
  say('\n[8/8] Check');
  const r = spawnSync(BIN, ['doctor'], { encoding: 'utf8', shell: WIN });
  process.stdout.write(r.stdout.replace(/^/gm, '  '));
  if (r.status !== 0) warn(`fill in the ✗ items in ${path.join(HOME, 'client')} (or let job-chief interview the client), then run: ${BIN} doctor`);
}

async function uninstall() {
  say(`Removing JobSquad agents and automations${opt.purge ? ` and ALL data in ${HOME}` : ''}.`);
  if (!(await confirm('Continue?'))) process.exit(1);
  OC = findOpenclaw();
  if (!OC) die('OpenClaw not found');
  const list = ocJson(['automations', 'list', '--all']);
  for (const j of (Array.isArray(list) ? list : list?.jobs || [])) {
    if (String(j.name || '').startsWith('jobsquad-')) { oc(['automations', 'remove', j.id || j.jobId], { allowFail: true }); ok(`automation ${j.name} removed`); }
  }
  for (const id of Object.keys(AGENTS)) {
    oc(['approvals', 'allowlist', 'remove', '--agent', id, BIN], { allowFail: true });
    const r = oc(['agents', 'delete', id, '--force'], { allowFail: true });
    if (r.status === 0) ok(`${id} deleted (workspace moved to Trash)`);
  }
  const desk = path.join(os.homedir(), 'Desktop');
  for (const f of ['JobSquad.command', 'JobSquad Files']) {
    const p = path.join(desk, f);
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() ? path.resolve(fs.readlinkSync(p)) === HOME : fs.readFileSync(p, 'utf8').includes(HOME)) { fs.rmSync(p); ok(`Desktop/${f} removed`); }
    } catch {}
  }
  if (opt.purge) { fs.rmSync(HOME, { recursive: true, force: true }); ok(`${HOME} deleted`); }
  else say(`  Client data kept in ${HOME}. Use --purge to delete it.`);
}

// ---------------------------------------------------------------- beginner helpers
const PORT_DEFAULT = 18789;
function gatewayPort() {
  const r = oc(['config', 'get', 'gateway.port'], { allowFail: true, capture: true });
  const n = Number((r.stdout || '').trim().split('\n').pop());
  return Number.isInteger(n) && n > 0 ? n : PORT_DEFAULT;
}
async function gatewayUp(port, waitSeconds = 0) {
  for (let i = 0; i <= waitSeconds; i++) {
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }); return true; } catch {}
    if (i < waitSeconds) await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// Make sure OpenClaw can think (model login) and is running, fixing what we can.
async function beginnerChecks() {
  say(`\n${'Checking OpenClaw'}`);
  if (!OC) {
    say(`
  OpenClaw isn't installed on this Mac yet. JobSquad runs inside OpenClaw.
  1. Your browser will open openclaw.ai. Download and install OpenClaw.
  2. Open it once and follow its setup (it asks you to connect an AI account).
  3. Then double-click "Install JobSquad" again.`);
    if (process.platform === 'darwin') spawnSync('open', ['https://openclaw.ai']);
    process.exit(1);
  }
  let r = oc(['models', 'status', '--check'], { allowFail: true, capture: true });
  if (r.status === 1) {
    say(`
  OpenClaw isn't connected to an AI account yet. JobSquad needs one to read jobs and write
  applications (for example a Claude or ChatGPT subscription, or an API key).
  OpenClaw's own setup will start now. Pick the quick start and follow the steps.`);
    await wiz.pause('  Press Enter to start OpenClaw setup…');
    wiz.closeIo();
    oc(['onboard', '--flow', 'quickstart', '--install-daemon'], { allowFail: true, inherit: true });
    r = oc(['models', 'status', '--check'], { allowFail: true, capture: true });
    if (r.status === 1) die('OpenClaw still has no working AI account. Open the OpenClaw app, finish its setup, then run this installer again.');
  }
  ok('AI account connected');
  const port = gatewayPort();
  if (!(await gatewayUp(port))) {
    say('  Starting OpenClaw in the background (it will also start when you log in)…');
    oc(['daemon', 'install'], { allowFail: true });
    oc(['daemon', 'start'], { allowFail: true });
    if (!(await gatewayUp(port, 30))) die('OpenClaw did not start. Open the OpenClaw app once, then run this installer again.');
  }
  ok('OpenClaw is running');
  return port;
}

async function restartGateway(port) {
  say('\n  Restarting OpenClaw so it loads the JobSquad team…');
  const r = oc(['daemon', 'restart'], { allowFail: true });
  if (r.status !== 0) oc(['gateway', 'restart'], { allowFail: true });
  if (!(await gatewayUp(port, 45))) warn('OpenClaw is taking long to restart; schedules may need: ./install/install.sh --only schedule');
  else ok('OpenClaw restarted');
}

function clientAlreadySetUp() {
  try { return !/REPLACE/.test(fs.readFileSync(path.join(HOME, 'client', 'client.jsonc'), 'utf8').match(/"name"\s*:\s*"([^"]*)"/)[1]); } catch { return false; }
}

async function wizardFlow() {
  preflight();
  let answers = null;
  if (!clientAlreadySetUp() || await wiz.yes(`JobSquad is already set up on this Mac. Answer the setup questions again?`, false)) {
    answers = await wiz.interview();
  }
  const port = await beginnerChecks();
  say('\nInstalling JobSquad (about a minute)…');
  files();
  if (answers) {
    wiz.writeClientFiles(HOME, answers, Intl.DateTimeFormat().resolvedOptions().timeZone);
    ok('your answers saved');
  }
  agents();
  config();
  approvals();
  await restartGateway(port);
  schedule();
  say('\nLooking for jobs for the first time…');
  const f = spawnSync(BIN, ['fetch', '--quiet'], { encoding: 'utf8' });
  say(`  ${(f.stdout || f.stderr || '').trim().split('\n')[0]}`);
  const shortcuts = answers?.shortcut !== false ? wiz.makeShortcuts(HOME, OC.bin, port) : [];
  fs.copyFileSync(path.join(KIT, 'docs', 'HOW-TO-USE.md'), path.join(HOME, 'HOW-TO-USE.md'));
  spawnSync(BIN, ['notify', 'JobSquad', 'Setup finished. Say hi in the chat!'], { encoding: 'utf8' });
  say(`
${'\x1b[32m'}✓ JobSquad is ready.${'\x1b[0m'}

  ${shortcuts.length ? 'Double-click the "JobSquad" icon on your Desktop' : `Open http://127.0.0.1:${port}/chat/job-chief`} any time to chat with your
  job search lead. It's opening now. Say "Hi". It will check your CV with you and start the search.

  Every weekday at 08:00 your new matches appear in that chat (you'll get a notification).
  Reply with "approve 12" or "skip 12". Your files and applications are in "JobSquad Files".
  A short guide: ${path.join(HOME, 'HOW-TO-USE.md')}
`);
  if (process.platform === 'darwin') {
    spawnSync(OC.bin, [...(opt.profile ? ['--profile', opt.profile] : []), 'dashboard'], { encoding: 'utf8', timeout: 60_000 });
    try { fs.writeFileSync(path.join(HOME, '.paired'), ''); } catch {}
    await new Promise((r) => setTimeout(r, 3000));
    spawnSync('open', [`http://127.0.0.1:${port}/chat/job-chief?draft=${encodeURIComponent('Hi! I just set up JobSquad.')}`]);
  }
  wiz.closeIo();
}

// ---------------------------------------------------------------- main
(async () => {
  say(`JobSquad ${fs.readFileSync(path.join(KIT, 'VERSION'), 'utf8').trim()} installer → ${HOME}${opt.profile ? ` (OpenClaw profile ${opt.profile})` : ''}`);
  if (opt.uninstall) return uninstall();
  if (opt.wizard) return wizardFlow();
  preflight();
  if (runStep('files')) files();
  if (runStep('agents')) agents();
  if (runStep('config')) config();
  if (runStep('approvals')) approvals();
  if (runStep('bind')) bind();
  if (runStep('schedule')) schedule();
  if (runStep('doctor')) doctor();
  say(`\nDone. Next:
  1. Fill ${path.join(HOME, 'client')}/master_resume.md, answers.jsonc, client.jsonc (or let job-chief interview the client).
  2. Make sure OpenClaw's browser starts (the Applier never signs in anywhere):  openclaw browser start
  3. Test:  ${BIN} fetch   then   openclaw agent --agent job-chief --message "DAILY_RUN"
  4. Restart the gateway so new agents load:  openclaw gateway restart`);
})();
