// Guided setup for people who have never used OpenClaw or AI tools.
// Asks plain-language questions, then fills the client files that setup.mjs created.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const MAC = process.platform === 'darwin';
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;

// A buffered line reader: works when typing and when answers are piped in quickly.
let rl;
let lines;
async function readLine(prompt) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    rl.on('SIGINT', () => { console.log('\n\nSetup stopped. Nothing was sent anywhere. Run it again any time.'); process.exit(130); });
    lines = rl[Symbol.asyncIterator]();
  }
  process.stdout.write(prompt);
  const { value, done } = await lines.next();
  if (done) { console.log('\n\nSetup needs answers typed in a Terminal window. Run it again.'); process.exit(1); }
  if (!process.stdin.isTTY) process.stdout.write(`${value}\n`);
  return value;
}
export function closeIo() { rl?.close(); rl = null; lines = null; }

export async function ask(question, { def = '', required = false, hint = '' } = {}) {
  for (;;) {
    if (hint) console.log(DIM(`   ${hint}`));
    const a = (await readLine(`${B('›')} ${question}${def ? DIM(` [${def}]`) : ''} `)).trim();
    if (a) return a;
    if (def) return def;
    if (!required) return '';
    console.log('   Please type an answer (or press Ctrl+C to stop).');
  }
}

export async function yes(question, def = true) {
  const a = (await ask(`${question} ${DIM(def ? '(Y/n)' : '(y/N)')}`)).toLowerCase();
  return a ? /^(y|yes|e|evet|j|ja|o|oui|s|si|sí)/.test(a) : def;
}

async function choose(question, options, def = 1) {
  console.log(`${B('›')} ${question}`);
  options.forEach((o, i) => console.log(`   ${B(String(i + 1))}. ${o.label}${o.help ? DIM(` — ${o.help}`) : ''}`));
  for (;;) {
    const a = await ask('Type a number:', { def: String(def) });
    const n = Number(a);
    if (n >= 1 && n <= options.length) return options[n - 1].value;
  }
}

const list = (s) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
export function pause(msg = 'Press Enter to continue…') { return readLine(DIM(`${msg} `)); }

// ---------------------------------------------------------------- macOS helpers
export function pickFile(prompt) {
  if (!MAC) return null;
  const types = '{"com.adobe.pdf","org.openxmlformats.wordprocessingml.document","com.microsoft.word.doc","public.rtf","public.plain-text"}';
  const r = spawnSync('osascript', ['-e', `POSIX path of (choose file with prompt "${prompt}" of type ${types})`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function documentText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(file, 'utf8');
  if (MAC && ext === '.pdf') {
    const js = 'ObjC.import("Quartz"); function run(argv) { const d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0])); return d.isNil() ? "" : ObjC.unwrap(d.string); }';
    const r = spawnSync('osascript', ['-l', 'JavaScript', '-e', js, file], { encoding: 'utf8', maxBuffer: 20e6 });
    return r.status === 0 ? r.stdout : '';
  }
  if (MAC && ['.docx', '.doc', '.rtf'].includes(ext)) {
    const r = spawnSync('textutil', ['-convert', 'txt', '-stdout', file], { encoding: 'utf8', maxBuffer: 20e6 });
    return r.status === 0 ? r.stdout : '';
  }
  return '';
}

// ---------------------------------------------------------------- JSONC editing (keeps comments)
function setKey(text, key, value) {
  const re = new RegExp(`("${key}"\\s*:\\s*)(\\[[^\\]]*\\]|\\{[^{}]*\\}|"(?:[^"\\\\]|\\\\.)*"|[^,\\n/]+?)(\\s*(?:,|\\n|//))`);
  if (!re.test(text)) throw new Error(`template key "${key}" not found`);
  return text.replace(re, (m, a, _old, c) => `${a}${JSON.stringify(value)}${c}`);
}
function setBlock(text, key, obj) {
  const re = new RegExp(`"${key}"\\s*:\\s*\\{[\\s\\S]*?\\n  \\}`);
  const body = Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return text.replace(re, `"${key}": {\n${body}\n  }`);
}

// ---------------------------------------------------------------- the interview
export async function interview() {
  console.log(`
${B('Welcome to JobSquad')} 👋

JobSquad is a small team of AI assistants that live on this Mac. Every weekday morning they:
  1. look through thousands of new job postings for you,
  2. pick the ones that really fit, and explain why in one line,
  3. ask you which ones you want, then
  4. write a matching CV and cover letter and fill in the application for you.

${B('Nothing is ever sent without your OK.')} They never make up experience, never create accounts or
use passwords, and they stop and ask you whenever something is unclear.

Setup takes about 10 minutes. Answer in your own words; you can change everything later.
`);
  await pause();

  const a = {};
  console.log(`\n${B('1. About you')}  ${DIM('(used to fill in application forms)')}`);
  a.name = await ask('Your full name:', { required: true });
  a.email = await ask('Email address employers should use:', { required: true });
  a.phone = await ask('Phone number (with country code):', { hint: 'e.g. +90 555 123 45 67' });
  a.city = await ask('City you live in:', { required: true });
  a.country = await ask('Country:', { required: true });
  a.linkedin = await ask('LinkedIn profile link (press Enter to skip):');

  console.log(`\n${B('2. Your CV')}`);
  console.log('   JobSquad builds every application from your CV, and it is only ever allowed to use what is in it.');
  if (MAC && await yes('Choose your CV file now? (PDF or Word)')) {
    a.resumeFile = pickFile('Choose your CV (PDF or Word)');
    if (a.resumeFile) {
      a.resumeText = documentText(a.resumeFile).trim();
      console.log(a.resumeText.length > 200
        ? GREEN(`   ✓ Read ${a.resumeText.split(/\s+/).length} words from ${path.basename(a.resumeFile)}`)
        : '   ! Could not read text from that file (maybe it is a scanned image). JobSquad will ask you about your experience in the chat instead.');
    }
  }
  if (!a.resumeFile) {
    const p = await ask('Or drag your CV file into this window and press Enter (or just Enter to skip):');
    a.resumeFile = p ? p.replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ') : null;
    if (a.resumeFile && fs.existsSync(a.resumeFile)) a.resumeText = documentText(a.resumeFile).trim();
    else a.resumeFile = null;
  }

  console.log(`\n${B('3. What you are looking for')}`);
  a.titles = list(await ask('Which job titles? Separate with commas.', { required: true, hint: 'e.g. Data Analyst, Business Analyst, Reporting Specialist' }));
  a.excludeTitles = list(await ask('Any words that rule a job OUT? (Enter to skip)', { hint: 'e.g. intern, director, sales' }));
  a.locations = list(await ask('Where can you work? Cities, countries or regions, separated by commas.', { required: true, def: `${a.city}, ${a.country}` }));
  a.remote = await yes('Are fully remote jobs OK too?', true);
  a.relocate = await ask('Would you move to another city or country for the right job?', { def: 'No', hint: 'e.g. "No", "Yes, within the EU", "Yes, anywhere"' });
  a.notes = await ask('Anything else they should know? Industries you like or avoid, company size… (Enter to skip)');

  console.log(`\n${B('4. Work permits')}  ${DIM('(application forms always ask this; it must be exactly right)')}`);
  a.workAuth = {};
  a.workAuth[a.country] = await ask(`Can you work in ${a.country} without a visa?`, { def: 'Yes, citizen, no sponsorship needed' });
  for (;;) {
    const other = await ask('Any OTHER country or region where you can work without a visa? (type its name, or Enter for none)');
    if (!other) break;
    a.workAuth[other] = await ask(`What should forms say for ${other}?`, { def: 'Authorized to work, no sponsorship needed' });
  }
  a.workAuth.default = 'Requires sponsorship';

  console.log(`\n${B('5. Money and timing')}`);
  a.currency = (await ask('Salary currency:', { def: 'EUR', hint: 'e.g. EUR, TRY, USD, GBP' })).toUpperCase();
  a.minSalary = Number((await ask('Lowest yearly salary you would accept (numbers only, Enter to skip):')).replace(/[^\d]/g, '')) || null;
  a.targetSalary = Number((await ask('Yearly salary you are hoping for (numbers only, Enter to skip):')).replace(/[^\d]/g, '')) || null;
  a.notice = await ask('How soon could you start a new job?', { def: '1 month' });
  a.years = Number((await ask('Years of work experience in total (approximately):')).replace(/[^\d.]/g, '')) || null;

  console.log(`\n${B('6. How JobSquad works for you')}`);
  a.mode = await choose('How much should JobSquad do on its own?', [
    { value: 'review', label: 'Ask me before every application', help: 'recommended to start' },
    { value: 'assist', label: 'Fill in the forms, but I press Submit myself' },
    { value: 'auto', label: 'Apply on its own to very good matches, max 5 a day', help: 'you can switch to this later' },
  ]);
  a.perDay = a.mode === 'auto' ? 5 : 10;
  a.language = await ask('Which language should JobSquad write to you in?', { def: 'English', hint: 'e.g. English, Türkçe, Deutsch' });
  a.shortcut = MAC ? await yes('Put a "JobSquad" icon on your Desktop to open the chat?', true) : false;

  console.log(`\n${B('Consent')}`);
  console.log(`   To apply, JobSquad types your details into application forms on company job sites, uploads
   your CV, and ticks the required "I agree to the processing of my data for this application" box.
   It never signs up for newsletters or talent pools, never shares your data anywhere else,
   and keeps a copy and a screenshot of everything it sends in a folder on this Mac.`);
  if (!(await yes('Is that OK?', true))) {
    console.log('\nNo problem. Nothing was installed. Run setup again any time.');
    process.exit(0);
  }
  return a;
}

const LANG_CODE = { english: 'en', türkçe: 'tr', turkce: 'tr', turkish: 'tr', deutsch: 'de', german: 'de', français: 'fr', francais: 'fr', french: 'fr', español: 'es', espanol: 'es', spanish: 'es', italiano: 'it', nederlands: 'nl', português: 'pt', portugues: 'pt' };
export const langCode = (l) => LANG_CODE[String(l).trim().toLowerCase()] || (/^[a-z]{2}$/i.test(l) ? l.toLowerCase() : 'en');

// Write the answers into <home>/client. Only called on a fresh client folder or when the user confirms.
export function writeClientFiles(home, a, tz) {
  const dir = path.join(home, 'client');
  let c = fs.readFileSync(path.join(dir, 'client.jsonc'), 'utf8');
  c = setKey(c, 'name', a.name);
  c = setKey(c, 'timezone', tz);
  c = setKey(c, 'language', langCode(a.language));
  c = setKey(c, 'mode', a.mode);
  c = setKey(c, 'max_applications_per_day', a.perDay);
  c = setKey(c, 'titles', a.titles);
  c = setKey(c, 'exclude_title', a.excludeTitles);
  c = setKey(c, 'locations', [...new Set([...a.locations, a.city, a.country])]);
  c = setKey(c, 'remote_ok', a.remote);
  c = setKey(c, 'notes', [a.notes, a.relocate && !/^no$/i.test(a.relocate) ? `Open to relocating: ${a.relocate}.` : ''].filter(Boolean).join(' '));
  if (/germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|stuttgart|düsseldorf|austria|österreich|vienna|wien|switzerland|schweiz|zurich|zürich|europe|\beu\b/i.test(a.locations.join(' '))) {
    c = c.replace('"arbeitnow": { "enabled": false }', '"arbeitnow": { "enabled": true }');
  }
  fs.writeFileSync(path.join(dir, 'client.jsonc'), c);

  const [first, ...rest] = a.name.split(/\s+/);
  let s = fs.readFileSync(path.join(dir, 'answers.jsonc'), 'utf8');
  s = setKey(s, 'first_name', first);
  s = setKey(s, 'last_name', rest.join(' '));
  s = setKey(s, 'email', a.email);
  s = setKey(s, 'phone', a.phone);
  s = setKey(s, 'city', a.city);
  s = setKey(s, 'country', a.country);
  s = setKey(s, 'linkedin', a.linkedin);
  s = setBlock(s, 'work_authorization', a.workAuth);
  s = setKey(s, 'willing_to_relocate', a.relocate);
  s = setKey(s, 'remote_preference', a.remote ? 'Open to remote, hybrid or on-site' : 'On-site or hybrid');
  s = setKey(s, 'notice_period', a.notice);
  s = setKey(s, 'earliest_start_date', `Available with ${a.notice} notice`);
  s = setKey(s, 'currency', a.currency);
  s = setKey(s, 'minimum_annual', a.minSalary);
  s = setKey(s, 'target_annual', a.targetSalary);
  if (a.minSalary && a.targetSalary) {
    s = setKey(s, 'answer_text', `My expectation is around ${a.targetSalary.toLocaleString('en')} ${a.currency} per year, depending on the full package.`);
  }
  s = s.replace(/"years_experience": \{ "total": null \}/, `"years_experience": { "total": ${a.years ?? 'null'} }`);
  fs.writeFileSync(path.join(dir, 'answers.jsonc'), s);

  if (a.resumeFile) fs.copyFileSync(a.resumeFile, path.join(dir, `resume${path.extname(a.resumeFile).toLowerCase() === '.pdf' ? '.pdf' : path.extname(a.resumeFile)}`));
  if (a.resumeText && a.resumeText.length > 200) {
    fs.writeFileSync(path.join(dir, 'master_resume.md'), `# ${a.name}

${[a.city, a.country].filter(Boolean).join(', ')} · ${a.email}${a.phone ? ` · ${a.phone}` : ''}${a.linkedin ? ` · ${a.linkedin}` : ''}

<!-- Imported from ${path.basename(a.resumeFile)} on ${new Date().toISOString().slice(0, 10)}.
job-chief will tidy this up and add detail by interviewing the client. Everything here must be true. -->

${a.resumeText.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n')}
`);
  }
}

// Desktop shortcuts that open the chat and the files folder.
// The chat link carries a fresh one-time pairing token from `openclaw dashboard --json`, so the
// browser (Safari, Chrome, …) is paired and lands on job-chief in one step, every time.
export function makeShortcuts(home, openclawBin, port, nodeBin = process.execPath) {
  const desk = path.join(os.homedir(), 'Desktop');
  if (!fs.existsSync(desk)) return [];
  const launcher = path.join(desk, 'JobSquad.command');
  fs.writeFileSync(launcher, `#!/bin/bash
# Opens your JobSquad chat. Double-click me.
OC='${openclawBin}'
NODE='${nodeBin}'
PORT=${port}
if ! curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/"; then
  echo "Starting JobSquad…"; "$OC" daemon start >/dev/null 2>&1 || "$OC" gateway start >/dev/null 2>&1
  for i in $(seq 1 30); do curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/" && break; sleep 1; done
fi
PAIR=$("$OC" dashboard --json 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const u=JSON.parse(s.slice(s.indexOf("{"))).browserUrl||"";const i=u.indexOf("#");process.stdout.write(i>=0?u.slice(i):"")}catch{}})')
open "http://127.0.0.1:$PORT/chat/job-chief$PAIR"
osascript -e 'tell application "Terminal" to close (every window whose name contains "JobSquad.command")' >/dev/null 2>&1 &
exit 0
`, { mode: 0o755 });
  const files = path.join(desk, 'JobSquad Files');
  try { fs.rmSync(files, { force: true }); fs.symlinkSync(home, files); } catch {}
  return [launcher, files];
}
