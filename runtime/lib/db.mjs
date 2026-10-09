// Tracker database (node:sqlite, bundled with the Node that OpenClaw already requires).
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { paths } from './config.mjs';

export const STATUSES = [
  'new', 'filtered', 'screened_out', 'shortlisted', 'approved', 'skipped',
  'drafting', 'ready', 'applying', 'applied', 'needs_human', 'failed',
  'interview', 'offer', 'rejected', 'withdrawn', 'ghosted', 'closed',
];
// Statuses where the posting still matters to us; used for closure detection.
export const OPEN_STATUSES = ['new', 'shortlisted', 'approved', 'drafting', 'ready'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  fp TEXT,
  source TEXT NOT NULL,
  ats TEXT,
  board TEXT,
  company TEXT,
  title TEXT,
  location TEXT,
  remote INTEGER,
  salary TEXT,
  url TEXT,
  apply_url TEXT,
  description TEXT,
  posted_at TEXT,
  fetched_at TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  score INTEGER,
  reason TEXT,
  qa_passed INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT,
  follow_up_at TEXT,
  evidence TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_fp ON jobs(fp);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  at TEXT NOT NULL,
  actor TEXT,
  event TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id);
CREATE TABLE IF NOT EXISTS boards (
  ats TEXT NOT NULL,
  token TEXT NOT NULL,
  company TEXT,
  added_by TEXT,
  added_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_ok TEXT,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ats, token)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

let db;
export function open() {
  if (db) return db;
  fs.mkdirSync(paths.data, { recursive: true });
  db = new DatabaseSync(paths.db);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  return db;
}

export const now = () => new Date().toISOString();

// Agents run commands from their own workspace (…/workspace-job-writer), so the folder names the actor.
export function actor() {
  return process.env.JOBSQUAD_ACTOR || process.cwd().match(/workspace-(job-[a-z]+)/)?.[1] || 'cli';
}

export function logEvent(jobId, event, detail = null) {
  open().prepare('INSERT INTO events (job_id, at, actor, event, detail) VALUES (?, ?, ?, ?, ?)')
    .run(jobId ?? null, now(), actor(), event, detail == null ? null : String(detail));
}

export function getJob(id) {
  const job = open().prepare('SELECT * FROM jobs WHERE id = ?').get(Number(id));
  if (!job) throw new Error(`No job #${id}`);
  return job;
}

export function hasEvent(jobId, event) {
  return !!open().prepare('SELECT 1 FROM events WHERE job_id = ? AND event = ? LIMIT 1').get(jobId, event);
}

export function setStatus(id, status, extra = {}, note) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status "${status}". Valid: ${STATUSES.join(', ')}`);
  const job = getJob(id);
  const fields = { status, updated_at: now(), ...extra };
  const cols = Object.keys(fields);
  open().prepare(`UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), job.id);
  if (note) appendNote(job.id, note);
  logEvent(job.id, status, note || (job.status !== status ? `from ${job.status}` : null));
  return getJob(job.id);
}

export function appendNote(id, text) {
  const job = getJob(id);
  const line = `[${now().slice(0, 16)} ${actor()}] ${text}`;
  open().prepare('UPDATE jobs SET notes = ?, updated_at = ? WHERE id = ?')
    .run(job.notes ? `${job.notes}\n${line}` : line, now(), job.id);
}

export function meta(key, value) {
  const d = open();
  if (value === undefined) return d.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  d.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
