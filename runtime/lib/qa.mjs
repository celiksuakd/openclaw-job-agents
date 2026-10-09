// Deterministic checks on a tailored application package before it can be marked ready.
// Main job: catch fabricated claims (new tools, new numbers) and wrong-company letters.
import fs from 'node:fs';
import path from 'node:path';
import { appDir, loadConfig, paths } from './config.mjs';
import { open } from './db.mjs';
import { norm } from './text.mjs';

const PLACEHOLDER = /\[(?:company(?: name)?|role|position|job title|title|your name|name|hiring manager|insert[^\]]*|date|x+)\]|\{\{|\}\}|\bTODO\b|\bTBD\b|\bXXX+\b|lorem ipsum|<insert/i;

// Capitalized words that are normal in resumes even when absent from the master resume.
const COMMON = new Set(`i a an the and or of in on at to for with by from as my our your their this that these those
summary profile experience professional work employment education skills technical core competencies projects project
certifications certification languages language awards publications volunteer interests references contact objective
highlights selected key relevant additional tools technologies present current remote hybrid onsite on-site
january february march april may june july august september october november december
jan feb mar apr jun jul aug sep sept oct nov dec
dear sincerely regards best kind thank thanks hello hi team hiring manager mr ms mrs dr
english turkish german french spanish`.split(/\s+/));

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

// Words that start a line, bullet, heading or sentence are skipped: they are capitalized anyway.
function properTerms(text) {
  const terms = new Set();
  for (const line of text.split('\n')) {
    const body = line.replace(/^\s*(?:#{1,6}|[-*•]|\d+[.)])\s*/, '');
    const re = /[A-Za-z][A-Za-z0-9+#./-]*[A-Za-z0-9+#]|[A-Za-z]/g;
    let m;
    let prevEnd = -1;
    let first = true;
    while ((m = re.exec(body))) {
      const w = m[0].replace(/[./-]+$/, '');
      const before = body.slice(Math.max(0, prevEnd), m.index);
      const sentenceStart = first || /[.!?:]\s*$/.test(before) || /\|\s*$/.test(before);
      prevEnd = m.index + m[0].length;
      first = false;
      if (sentenceStart && !/[A-Z].*[A-Z]|\d|[+#]/.test(w.slice(1))) continue;
      const techy = /[A-Z].*[A-Z]/.test(w) || /[+#]/.test(w) || (/\d/.test(w) && /[A-Za-z]/.test(w)) || /^[A-Z][a-z]/.test(w);
      if (techy && !COMMON.has(w.toLowerCase())) terms.add(w);
    }
  }
  return terms;
}

function numbers(text) {
  const out = new Set();
  const cleaned = text.replace(/^\s*\d+[.)]\s/gm, '');
  for (const m of cleaned.matchAll(/\d+(?:[.,]\d+)*/g)) out.add(m[0].replace(/[.,]/g, ''));
  return out;
}

function companyNames(job) {
  const full = norm(job.company);
  const first = full.split(' ').filter((w) => w.length > 2 && !['the', 'inc', 'ltd', 'gmbh', 'llc'].includes(w))[0];
  return [full, first].filter(Boolean);
}

export function runQa(job) {
  const cfg = loadConfig();
  const dir = appDir(job.id);
  const failures = [];
  const warnings = [];
  const master = read(paths.masterResume) || '';
  const masterNorm = ` ${norm(master)} `;
  const allow = new Set((cfg.writing.allow_terms || []).map((t) => norm(t)));
  const known = (term) => masterNorm.includes(` ${norm(term)} `) || allow.has(norm(term));
  const masterNums = numbers(master);

  if (!master.trim() || /REPLACE ME|<your name>/i.test(master)) failures.push('client/master_resume.md is missing or still the template');

  const resumeNeeded = cfg.writing.resume_strategy === 'tailored';
  const resume = read(path.join(dir, 'resume.md'));
  const letter = read(path.join(dir, 'cover_letter.md'));
  const answers = read(path.join(dir, 'answers.md'));

  if (resumeNeeded && !resume) failures.push('resume.md missing');
  if (cfg.writing.cover_letter && !letter) failures.push('cover_letter.md missing');
  if (!resumeNeeded && !fs.existsSync(paths.originalResume)) failures.push('resume_strategy is "original" but client/resume.pdf is missing');

  for (const [name, text] of [['resume.md', resume], ['cover_letter.md', letter], ['answers.md', answers]]) {
    if (text && PLACEHOLDER.test(text)) failures.push(`${name}: placeholder text left in (${text.match(PLACEHOLDER)[0]})`);
  }

  if (resume) {
    const newTerms = [...properTerms(resume)].filter((t) => !known(t));
    if (newTerms.length) failures.push(`resume.md names things not in the master resume: ${newTerms.slice(0, 15).join(', ')}. Remove them, or add to writing.allow_terms only if the client confirms they are true.`);
    const newNums = [...numbers(resume)].filter((n) => !masterNums.has(n));
    if (newNums.length) failures.push(`resume.md has numbers not in the master resume: ${newNums.slice(0, 10).join(', ')}`);
    const words = resume.split(/\s+/).length;
    if (words > 950) warnings.push(`resume.md is ${words} words; aim for ≤ 2 pages (~900 words)`);
    const cn = companyNames(job);
    if (cn.length && ` ${norm(resume)} `.includes(` ${cn[0]} `) && !masterNorm.includes(` ${cn[0]} `)) {
      warnings.push(`resume.md mentions ${job.company}; résumés normally don't name the target company`);
    }
  }

  if (letter) {
    const ln = ` ${norm(letter)} `;
    if (!companyNames(job).some((c) => ln.includes(` ${c} `))) failures.push(`cover_letter.md never names ${job.company}`);
    const others = open().prepare(`SELECT DISTINCT company FROM jobs WHERE id != ? AND status IN
      ('approved','drafting','ready','applying','applied','needs_human') AND updated_at >= ?`)
      .all(job.id, new Date(Date.now() - 30 * 864e5).toISOString())
      .map((r) => r.company)
      .filter((c) => c && norm(c).length >= 4 && norm(c) !== norm(job.company) && !masterNorm.includes(` ${norm(c)} `));
    const wrong = others.filter((c) => ln.includes(` ${norm(c)} `));
    if (wrong.length) failures.push(`cover_letter.md mentions other target companies: ${wrong.join(', ')} (copy-paste error?)`);
    const newNums = [...numbers(letter)].filter((n) => !masterNums.has(n));
    if (newNums.length) warnings.push(`cover_letter.md has numbers not in the master resume: ${newNums.slice(0, 8).join(', ')}. Fine for facts about the company; never for the client's achievements.`);
    const words = letter.split(/\s+/).length;
    if (words < 120 || words > 400) warnings.push(`cover_letter.md is ${words} words; aim for 180–300`);
  }

  if (answers) {
    const newNums = [...numbers(answers)].filter((n) => !masterNums.has(n));
    if (newNums.length) warnings.push(`answers.md has numbers not in the master resume: ${newNums.slice(0, 8).join(', ')}`);
  }

  return { id: job.id, pass: failures.length === 0, failures, warnings, dir };
}
