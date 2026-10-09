// Paths, client settings, and a small JSONC reader (comments + trailing commas).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = path.resolve(process.env.JOBSQUAD_HOME || path.join(os.homedir(), 'jobsquad'));

export const paths = {
  home: HOME,
  client: path.join(HOME, 'client'),
  config: path.join(HOME, 'client', 'client.jsonc'),
  answers: path.join(HOME, 'client', 'answers.jsonc'),
  masterResume: path.join(HOME, 'client', 'master_resume.md'),
  originalResume: path.join(HOME, 'client', 'resume.pdf'),
  data: path.join(HOME, 'data'),
  db: path.join(HOME, 'data', 'jobsquad.db'),
  apps: path.join(HOME, 'applications'),
  reports: path.join(HOME, 'reports'),
};

export const appDir = (id) => path.join(paths.apps, String(id));

export function stripJsonc(src) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i++; }
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '}' || src[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

export function readJsonc(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(stripJsonc(raw));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

const DEFAULTS = {
  mode: 'review',
  paused: false,
  limits: {
    max_applications_per_day: 10,
    max_per_company_30d: 2,
    min_score_to_shortlist: 70,
    min_score_auto_apply: 85,
    max_digest_items: 12,
    follow_up_after_days: 7,
    ghost_after_days: 30,
  },
  search: { titles: [], exclude_title: [], locations: [], remote_ok: true, exclude_companies: [], must_have_any: [], deal_breakers: [], max_age_days: 21 },
  sources: {},
  apply_policy: {
    auto_submit_ats: ['greenhouse', 'lever', 'ashby'],
    requires_human_ats: ['workday', 'icims', 'taleo', 'successfactors', 'oracle'],
    never_apply_domains: ['linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com'],
  },
  writing: { resume_strategy: 'tailored', cover_letter: true, allow_terms: [] },
};

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = k in base ? merge(base[k], v) : v;
  return out;
}

let cached;
export function loadConfig() {
  if (cached) return cached;
  if (!fs.existsSync(paths.config)) throw new Error(`Missing ${paths.config}. Run the installer or copy client-template/client.jsonc.`);
  cached = merge(DEFAULTS, readJsonc(paths.config));
  return cached;
}

export function loadAnswers() {
  return fs.existsSync(paths.answers) ? readJsonc(paths.answers) : {};
}
