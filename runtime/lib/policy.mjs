// The apply gate. Agents must call `jobsquad can-apply <id>` before touching an application form.
// It is deterministic on purpose: a model can't talk its way past it.
import { loadConfig } from './config.mjs';
import { open, hasEvent } from './db.mjs';
import { detectAts } from './sources.mjs';

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

export function canApply(job) {
  const cfg = loadConfig();
  const ap = cfg.apply_policy;
  const lim = cfg.limits;
  const reasons = [];
  const warnings = [];
  const d = open();

  if (cfg.paused) reasons.push('search is paused ("paused": true in client.jsonc)');
  if (!['review', 'assist', 'auto'].includes(cfg.mode)) reasons.push(`unknown mode "${cfg.mode}" in client.jsonc`);
  if (job.status !== 'ready') reasons.push(`status is "${job.status}"; it must be "ready" (writer done, QA passed)`);
  if (!job.qa_passed) reasons.push('QA has not passed (jobsquad qa <id>)');

  const ats = job.ats && job.ats !== 'other' ? job.ats : detectAts(job.apply_url || job.url);
  const approved = hasEvent(job.id, 'approved');
  const autoEligible = cfg.mode === 'auto'
    && (job.score ?? 0) >= lim.min_score_auto_apply
    && ap.auto_submit_ats.includes(ats);
  if (!approved && !autoEligible) {
    reasons.push(cfg.mode === 'auto'
      ? `not approved by the client and not auto-eligible (score ${job.score ?? '-'} vs ${lim.min_score_auto_apply}, ATS "${ats}")`
      : 'the client has not approved this job');
  }

  let host = '';
  try { host = new URL(job.apply_url || job.url).hostname.toLowerCase(); } catch { reasons.push('apply URL is missing or invalid'); }
  const blocked = ap.never_apply_domains.find((dom) => host === dom || host.endsWith(`.${dom}`));
  if (blocked) reasons.push(`${host} is on never_apply_domains; apply on the company's own careers page instead`);

  const last24h = d.prepare('SELECT COUNT(*) AS n FROM jobs WHERE applied_at >= ?').get(daysAgo(1)).n;
  if (last24h >= lim.max_applications_per_day) reasons.push(`daily cap reached (${last24h}/${lim.max_applications_per_day} in the last 24h)`);

  const sameCompany = d.prepare('SELECT COUNT(*) AS n FROM jobs WHERE applied_at >= ? AND lower(company) = lower(?) AND id != ?')
    .get(daysAgo(30), job.company || '', job.id).n;
  if (sameCompany >= lim.max_per_company_30d) reasons.push(`already applied to ${job.company} ${sameCompany} time(s) in 30 days`);

  const dup = job.fp && d.prepare('SELECT id FROM jobs WHERE fp = ? AND id != ? AND applied_at IS NOT NULL').get(job.fp, job.id);
  if (dup) reasons.push(`same posting already applied as #${dup.id}`);

  let action = cfg.mode === 'assist' ? 'fill_only' : 'submit';
  if (ap.requires_human_ats.includes(ats)) {
    action = 'fill_only';
    warnings.push(`${ats} normally requires a candidate account; expect needs_human`);
  }

  return { id: job.id, allow: reasons.length === 0, action, mode: cfg.mode, ats, reasons, warnings };
}
