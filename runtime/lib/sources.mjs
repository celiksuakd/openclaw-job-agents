// Job sources. Only official public JSON endpoints: no logins, no page scraping.
// Every fetcher returns normalized jobs:
// { uid, source, ats, board, company, title, location, remote, salary, url, apply_url, description, posted_at }
import { htmlToText } from './text.mjs';

const UA = 'jobsquad/1.0';

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const enc = encodeURIComponent;
const iso = (v) => {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const pretty = (token) => token.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const remoteFrom = (text) => (/\b(remote|anywhere|worldwide)\b/i.test(text || '') ? 1 : null);

// Board sources: one company board per token. `full` = the API returns the whole board, so
// postings missing from a successful fetch can be marked closed.
export const BOARD_SOURCES = {
  greenhouse: {
    full: true,
    async fetch(token) {
      const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${enc(token)}/jobs?content=true`);
      return (d.jobs || []).map((j) => ({
        uid: `greenhouse:${token}:${j.id}`,
        company: j.company_name || pretty(token),
        title: j.title,
        location: j.location?.name || '',
        remote: remoteFrom(j.location?.name) ?? remoteFrom((j.metadata || []).map((m) => m.value).join(' ')),
        url: j.absolute_url,
        apply_url: j.absolute_url,
        description: htmlToText(j.content || ''),
        posted_at: iso(j.first_published || j.updated_at),
      }));
    },
  },
  lever: {
    full: true,
    async fetch(token) {
      const d = await getJSON(`https://api.lever.co/v0/postings/${enc(token)}?mode=json`);
      return (Array.isArray(d) ? d : []).map((p) => ({
        uid: `lever:${token}:${p.id}`,
        company: pretty(token),
        title: p.text,
        location: p.categories?.location || (p.categories?.allLocations || []).join('; '),
        remote: p.workplaceType === 'remote' ? 1 : remoteFrom(p.categories?.location),
        salary: p.salaryRange ? `${p.salaryRange.currency || ''} ${p.salaryRange.min}–${p.salaryRange.max} ${p.salaryRange.interval || ''}`.trim() : null,
        url: p.hostedUrl,
        apply_url: p.applyUrl || p.hostedUrl,
        description: [p.openingPlain, p.descriptionBodyPlain || p.descriptionPlain,
          ...(p.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), p.additionalPlain].filter(Boolean).join('\n\n'),
        posted_at: iso(p.createdAt),
      }));
    },
  },
  ashby: {
    full: true,
    async fetch(token) {
      const d = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${enc(token)}?includeCompensation=true`);
      return (d.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
        uid: `ashby:${token}:${j.id}`,
        company: pretty(token),
        title: j.title,
        location: [j.location, ...(j.secondaryLocations || []).map((s) => (typeof s === 'string' ? s : s.location || s.locationName))].filter(Boolean).join('; '),
        remote: j.isRemote || /remote/i.test(j.workplaceType || '') ? 1 : remoteFrom(j.location),
        salary: j.compensation?.scrapeableCompensationSalarySummary || j.compensation?.compensationTierSummary || null,
        url: j.jobUrl,
        apply_url: j.applyUrl || j.jobUrl,
        description: j.descriptionPlain || htmlToText(j.descriptionHtml || ''),
        posted_at: iso(j.publishedAt),
      }));
    },
  },
  workable: {
    full: true,
    async fetch(token) {
      const d = await getJSON(`https://apply.workable.com/api/v1/widget/accounts/${enc(token)}`);
      return (d.jobs || []).map((j) => ({
        uid: `workable:${token}:${j.shortcode}`,
        company: d.name || pretty(token),
        title: j.title,
        location: [j.city, j.state, j.country].filter(Boolean).join(', ')
          || (j.locations || []).map((l) => [l.city, l.country].filter(Boolean).join(', ')).join('; '),
        remote: j.telecommuting ? 1 : null,
        url: j.url || j.shortlink,
        apply_url: j.application_url || j.url,
        description: '', // not in the widget API; the matcher reads the public page when needed
        posted_at: iso(j.published_on || j.created_at),
      }));
    },
  },
  smartrecruiters: {
    full: false, // searched by keyword, so absence does not mean closed
    async fetch(token, cfg) {
      const terms = cfg.search.titles?.length ? cfg.search.titles : [''];
      const seen = new Map();
      for (const q of terms.filter((t) => !t.startsWith('/'))) {
        const d = await getJSON(`https://api.smartrecruiters.com/v1/companies/${enc(token)}/postings?limit=100&q=${enc(q)}`);
        for (const p of d.content || []) {
          seen.set(p.id, {
            uid: `smartrecruiters:${token}:${p.id}`,
            company: p.company?.name || pretty(token),
            title: p.name,
            location: p.location?.fullLocation || [p.location?.city, p.location?.country].filter(Boolean).join(', '),
            remote: p.location?.remote ? 1 : null,
            url: `https://jobs.smartrecruiters.com/${token}/${p.id}`,
            apply_url: `https://jobs.smartrecruiters.com/${token}/${p.id}`,
            description: '',
            posted_at: iso(p.releasedDate),
          });
        }
      }
      return [...seen.values()];
    },
  },
};

// Aggregator feeds: many companies, apply link usually points to the company's own ATS.
export const FEED_SOURCES = {
  remotive: async (cfg, opts = {}) => {
    const terms = (opts.search || cfg.search.titles || []).filter((t) => !t.startsWith('/'));
    const all = new Map();
    // Remotive asks for a handful of calls per day at most; one per search term is fine daily.
    for (const term of terms.slice(0, 4)) {
      const d = await getJSON(`https://remotive.com/api/remote-jobs?search=${enc(term)}&limit=100`);
      for (const j of d.jobs || []) {
        all.set(j.id, {
          uid: `remotive:${j.id}`,
          company: j.company_name,
          title: j.title,
          location: j.candidate_required_location || 'Remote',
          remote: 1,
          salary: j.salary || null,
          url: j.url,
          apply_url: j.url,
          description: htmlToText(j.description),
          posted_at: iso(j.publication_date),
        });
      }
    }
    return [...all.values()];
  },
  remoteok: async () => {
    const d = await getJSON('https://remoteok.com/api');
    return (Array.isArray(d) ? d.slice(1) : []).filter((j) => j.id).map((j) => ({
      uid: `remoteok:${j.id}`,
      company: j.company,
      title: j.position,
      location: j.location || 'Remote',
      remote: 1,
      salary: j.salary_min ? `USD ${j.salary_min}–${j.salary_max}` : null,
      url: j.url,
      apply_url: j.apply_url || j.url,
      description: htmlToText(j.description),
      posted_at: iso(j.date || j.epoch),
    }));
  },
  arbeitnow: async () => {
    const out = [];
    for (let page = 1; page <= 3; page++) {
      const d = await getJSON(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      for (const j of d.data || []) {
        out.push({
          uid: `arbeitnow:${j.slug}`,
          company: j.company_name,
          title: j.title,
          location: j.location || '',
          remote: j.remote ? 1 : 0,
          url: j.url,
          apply_url: j.url,
          description: htmlToText(j.description),
          posted_at: iso(j.created_at),
        });
      }
      if (!d.links?.next) break;
    }
    return out;
  },
  himalayas: async () => {
    const out = [];
    for (let offset = 0; offset < 300; offset += 100) {
      const d = await getJSON(`https://himalayas.app/jobs/api?limit=100&offset=${offset}`);
      for (const j of d.jobs || []) {
        out.push({
          uid: `himalayas:${j.guid || j.applicationLink}`,
          company: j.companyName,
          title: j.title,
          location: (j.locationRestrictions || []).join(', ') || 'Remote (anywhere)',
          remote: 1,
          salary: j.minSalary ? `${j.currency || ''} ${j.minSalary}–${j.maxSalary} ${j.salaryPeriod || ''}`.trim() : null,
          url: j.applicationLink || j.guid,
          apply_url: j.applicationLink || j.guid,
          description: htmlToText(j.description),
          posted_at: iso(j.pubDate),
        });
      }
      if (!d.jobs?.length) break;
    }
    return out;
  },
};

const ATS_PATTERNS = [
  ['greenhouse', /greenhouse\.io/],
  ['lever', /lever\.co/],
  ['ashby', /ashbyhq\.com/],
  ['workable', /workable\.com/],
  ['smartrecruiters', /smartrecruiters\.com/],
  ['workday', /myworkdayjobs\.com|workday\.com/],
  ['icims', /icims\.com/],
  ['taleo', /taleo\.net/],
  ['successfactors', /successfactors\.(com|eu)|sapsf/],
  ['oracle', /oraclecloud\.com/],
  ['bamboohr', /bamboohr\.com/],
  ['teamtailor', /teamtailor\.com/],
  ['personio', /personio\.(de|com)/],
  ['recruitee', /recruitee\.com/],
  ['jobvite', /jobvite\.com/],
  ['linkedin', /linkedin\.com/],
  ['indeed', /indeed\.com/],
];

export function detectAts(url = '') {
  for (const [name, re] of ATS_PATTERNS) if (re.test(url)) return name;
  return 'other';
}
