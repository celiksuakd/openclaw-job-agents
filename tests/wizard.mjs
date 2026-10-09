// Tests the beginner wizard: scripted answers in, client files out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsquad-wiz-'));
try {
  fs.mkdirSync(path.join(HOME, 'client'));
  for (const f of ['client.jsonc', 'answers.jsonc', 'master_resume.md']) fs.copyFileSync(path.join(KIT, 'client-template', f), path.join(HOME, 'client', f));
  const answers = ['', 'Ayşe Yılmaz', 'ayse@test.dev', '+90 555', 'Istanbul', 'Türkiye', '',
    ...(process.platform === 'darwin' ? ['n'] : []), '',
    'Data Analyst, BI Analyst', 'y', 'intern', 'Istanbul, Berlin', 'y', 'Yes, within the EU', 'likes fintech', '', 'Germany', '', '',
    'EUR', '40.000', '50000', '', '5', '1', 'Türkçe', ...(process.platform === 'darwin' ? ['n'] : []), 'y'].join('\n') + '\n';
  const script = `import * as w from ${JSON.stringify(pathToFileURL(path.join(KIT, 'install', 'wizard.mjs')).href)};
const a = await w.interview(); w.closeIo(); w.writeClientFiles(${JSON.stringify(HOME)}, a, 'Europe/Istanbul');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input: answers, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout.slice(-500));

  const { readJsonc } = await import(pathToFileURL(path.join(KIT, 'runtime', 'lib', 'config.mjs')).href);
  const c = readJsonc(path.join(HOME, 'client', 'client.jsonc'));
  const a = readJsonc(path.join(HOME, 'client', 'answers.jsonc'));
  assert.equal(c.client.name, 'Ayşe Yılmaz');
  assert.equal(c.client.language, 'tr');
  assert.deepEqual(c.search.titles, ['Data Analyst', 'BI Analyst']);
  assert.ok(c.search.locations.includes('Berlin'));
  assert.equal(c.sources.arbeitnow.enabled, true);
  assert.match(c.search.notes, /fintech/);
  assert.equal(a.identity.last_name, 'Yılmaz');
  assert.equal(a.work_authorization.Germany, 'Authorized to work, no sponsorship needed');
  assert.equal(a.salary.minimum_annual, 40000);
  assert.equal(a.years_experience.total, 5);
  const doc = spawnSync(process.execPath, ['--no-warnings', path.join(KIT, 'runtime', 'jobsquad.mjs'), 'doctor'], { env: { ...process.env, JOBSQUAD_HOME: HOME }, encoding: 'utf8' }).stdout;
  assert.match(doc, /✓ answers\.jsonc work authorization filled/);
  const { cleanTitles } = await import(pathToFileURL(path.join(KIT, 'install', 'wizard.mjs')).href);
  assert.deepEqual(cleanTitles('chemical engineering and management engineering jobs'), ['chemical engineer', 'management engineer']);
  assert.deepEqual(cleanTitles('Process Engineer, supply chain roles / Operations Analyst'), ['Process Engineer', 'supply chain', 'Operations Analyst']);
  console.log('wizard test passed');
} finally {
  fs.rmSync(HOME, { recursive: true, force: true });
}
