// End-to-end smoke test of the jobsquad CLI in a throwaway home. Offline by default.
//   node tests/smoke.mjs            offline pipeline: add → score → approve → prepare → QA → gate → applied
//   node tests/smoke.mjs --online   also fetches a real Greenhouse board
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsquad-test-'));
const CLI = path.join(KIT, 'runtime', 'jobsquad.mjs');
const env = { ...process.env, JOBSQUAD_HOME: HOME, JOBSQUAD_ACTOR: 'test', OPENCLAW_UPLOADS_DIR: path.join(HOME, 'uploads') };

function js(args, expectCode = 0) {
  const r = spawnSync(process.execPath, ['--no-warnings', CLI, ...args], { env, encoding: 'utf8' });
  assert.equal(r.status, expectCode, `jobsquad ${args.join(' ')} → exit ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const step = (name) => console.log(`• ${name}`);

try {
  step('init + client files');
  js(['init']);
  const client = path.join(HOME, 'client');
  const cfg = fs.readFileSync(path.join(KIT, 'client-template', 'client.jsonc'), 'utf8')
    .replace('"REPLACE Jane Doe"', '"Ayşe Test"')
    .replace('"remotive": { "enabled": true }', '"remotive": { "enabled": false }');
  fs.writeFileSync(path.join(client, 'client.jsonc'), cfg);
  fs.writeFileSync(path.join(client, 'answers.jsonc'), fs.readFileSync(path.join(KIT, 'client-template', 'answers.jsonc'), 'utf8')
    .replace('"first_name": "REPLACE"', '"first_name": "Ayşe"').replace('"last_name": "REPLACE"', '"last_name": "Test"')
    .replace('REPLACE@example.com', 'ayse@test.dev'));
  fs.writeFileSync(path.join(client, 'master_resume.md'), `# Ayşe Test
Istanbul, Türkiye · ayse@test.dev · +90 555 000 0000

## Experience
### Data Analyst — Trendyol
Istanbul · Mar 2021 – Present
- Built SQL and Python pipelines feeding Tableau dashboards for 40 category managers
- Cut weekly reporting time by 60% by automating Excel exports with Python

### Junior Analyst — Getir
Istanbul · Jul 2019 – Feb 2021
- Ran A/B test analysis for checkout experiments with 3 product teams

## Education
### BSc Industrial Engineering — Boğaziçi University
2015 – 2019

## Skills
- SQL, Python, pandas, Tableau, Excel, BigQuery, A/B testing
`);

  step('doctor');
  // Exit code depends on whether this machine has Chrome, so only check the content.
  const doc = spawnSync(process.execPath, ['--no-warnings', CLI, 'doctor'], { env, encoding: 'utf8' }).stdout;
  assert.match(doc, /✓ master_resume\.md filled in/);
  assert.match(doc, /✓ answers\.jsonc identity filled/);

  step('add + list + score');
  js(['add', '--url', 'https://job-boards.greenhouse.io/acme/jobs/1', '--title', 'Data Analyst', '--company', 'Acme', '--location', 'Remote, EMEA']);
  js(['add', '--url', 'https://job-boards.greenhouse.io/globex/jobs/2', '--title', 'Senior Data Analyst', '--company', 'Globex']);
  assert.match(js(['list', '--status', 'new']), /Acme/);
  assert.match(js(['score', '1', '88', '--reason', 'SQL+Python daily, remote EMEA']), /shortlisted/);
  assert.match(js(['score', '2', '40', '--reason', 'Gate: German C1']), /screened_out/);

  step('approval needs the client message');
  js(['approve', '1'], 1);
  js(['approve', '1', '--msg', 'approve 1']);
  js(['set', '1', 'approved'], 1);

  step('gate denies before the package is ready');
  js(['can-apply', '1'], 2);

  step('prepare + QA catches fabrication');
  const dir = js(['prepare', '1']).split('\n')[0].trim();
  fs.writeFileSync(path.join(dir, 'resume.md'), `# Ayşe Test
Istanbul, Türkiye · ayse@test.dev

## Experience
### Data Analyst — Trendyol
Istanbul · Mar 2021 – Present
- Built SQL and Python pipelines on Kubernetes serving 500 managers
`);
  fs.writeFileSync(path.join(dir, 'cover_letter.md'), 'Dear Globex hiring team,\n\n' + 'I would like to join your analytics team. '.repeat(20));
  const bad = spawnSync(process.execPath, ['--no-warnings', CLI, 'qa', '1'], { env, encoding: 'utf8' }).stdout;
  assert.match(bad, /FAIL/);
  assert.match(bad, /Kubernetes/);
  assert.match(bad, /500/);
  assert.match(bad, /never names Acme/);

  step('fixed package passes QA');
  fs.writeFileSync(path.join(dir, 'resume.md'), `# Ayşe Test
Istanbul, Türkiye · ayse@test.dev

## Experience
### Data Analyst — Trendyol
Istanbul · Mar 2021 – Present
- Built SQL and Python pipelines feeding Tableau dashboards for 40 category managers
- Cut weekly reporting time by 60% by automating Excel exports with Python

## Skills
- SQL, Python, pandas, Tableau, BigQuery
`);
  fs.writeFileSync(path.join(dir, 'cover_letter.md'), `Dear Acme hiring team,

${'Your posting asks for an analyst who can own reporting end to end, which is the work I do every day at Trendyol. '.repeat(6)}

Kind regards,
Ayşe Test`);
  fs.writeFileSync(path.join(dir, 'answers.md'), '## Why Acme?\nI enjoy building reporting that teams actually use.\n');
  assert.match(js(['qa', '1']), /PASS/);

  step('render (skipped without Chrome) + ready');
  const r = spawnSync(process.execPath, ['--no-warnings', CLI, 'render', '1'], { env, encoding: 'utf8' });
  const havePdf = /\.pdf$/m.test(r.stdout);
  console.log(havePdf ? '  PDFs rendered' : '  no Chrome here; PDF step skipped');
  js(['set', '1', 'ready']);

  step('gate allows; daily cap and evidence enforced');
  assert.match(js(['can-apply', '1']), /ALLOW \(submit\)/);
  if (havePdf) assert.match(js(['stage-upload', '1']), /Ayse_Test_Resume\.pdf/);
  js(['set', '1', 'applying']);
  const shot = path.join(HOME, 'confirmation.png');
  fs.writeFileSync(shot, 'png');
  assert.match(js(['applied', '1', '--evidence', shot]), /follow-up due/);
  assert.ok(fs.readdirSync(path.join(dir, 'evidence')).length === 1);

  step('never_apply_domains');
  js(['add', '--url', 'https://www.linkedin.com/jobs/view/3', '--title', 'Data Analyst', '--company', 'Initech', '--approved', '--msg', 'yes apply']);
  const gate = JSON.parse(spawnSync(process.execPath, ['--no-warnings', CLI, 'can-apply', '3', '--json'], { env, encoding: 'utf8' }).stdout);
  assert.equal(gate.allow, false);
  assert.ok(gate.reasons.some((x) => /never_apply_domains/.test(x)));

  step('digest + stats + export');
  assert.match(js(['digest']), /Applied \(1\)/);
  assert.match(js(['stats']), /applied 1/);
  assert.match(js(['export']), /rows/);
  assert.match(js(['log', '1']), /approved/);

  if (process.argv.includes('--online')) {
    step('online fetch (greenhouse:anthropic)');
    js(['boards', 'add', 'greenhouse', 'anthropic', '--company', 'Anthropic']);
    assert.match(js(['fetch', '--source', 'greenhouse']), /fetch: \d+ new/);
  }
  console.log('\nall smoke tests passed');
} finally {
  fs.rmSync(HOME, { recursive: true, force: true });
}
