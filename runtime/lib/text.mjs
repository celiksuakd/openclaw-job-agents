// Text helpers: HTML → plain text, a small Markdown → HTML converter, normalization.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·', euro: '€', pound: '£' };

export function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html = '') {
  if (!html) return '';
  // Some APIs (Greenhouse) return entity-escaped HTML; unescape once before stripping tags.
  let s = /&lt;[a-z/]/i.test(html) ? decodeEntities(html) : html;
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function norm(s = '') {
  return String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9+#]+/g, ' ').trim();
}

// "data analyst" matches "Senior Data Analyst, Growth". "/regex/" terms are treated as regex.
export function matchTerm(text, term) {
  if (!term) return false;
  if (term.length > 2 && term.startsWith('/') && term.endsWith('/')) return new RegExp(term.slice(1, -1), 'i').test(text);
  return ` ${norm(text)} `.includes(` ${norm(term)} `);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// Enough Markdown for resumes and letters: headings, lists, bold/italic, links, rules, paragraphs.
export function markdownToHtml(md = '') {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushPara(); if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out.join('\n');
}
