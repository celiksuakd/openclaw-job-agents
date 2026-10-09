// Markdown → HTML → PDF using the Chrome/Chromium/Edge that OpenClaw's browser already needs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { markdownToHtml } from './text.mjs';

const CSS = `
@page { size: A4; margin: 16mm 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.38; color: #1a1a1a; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 2pt; letter-spacing: -0.2pt; }
h1 + p { margin-top: 0; color: #444; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.8pt; border-bottom: 0.75pt solid #999; padding-bottom: 2pt; margin: 12pt 0 5pt; }
h3 { font-size: 10.5pt; margin: 8pt 0 2pt; }
h4 { font-size: 10pt; margin: 4pt 0 2pt; color: #444; font-weight: normal; }
p { margin: 0 0 6pt; }
ul, ol { margin: 2pt 0 6pt; padding-left: 14pt; }
li { margin: 0 0 2pt; }
a { color: inherit; text-decoration: none; }
hr { border: 0; border-top: 0.75pt solid #ccc; margin: 8pt 0; }
body.letter { font-size: 11pt; line-height: 1.5; }
body.letter p { margin-bottom: 9pt; }
`;

export function toHtml(md, title, kind) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head>`
    + `<body class="${kind}">${markdownToHtml(md)}</body></html>`;
}

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

export function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    win32: [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ],
  }[process.platform] || [];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const c of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const p = which(c);
    if (p) return p;
  }
  return null;
}

export function htmlToPdf(htmlFile, pdfFile) {
  const chrome = findChrome();
  if (!chrome) return { ok: false, error: 'No Chrome/Chromium/Edge found. Set CHROME_PATH, or open the .html and print to PDF.' };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsquad-chrome-'));
  try {
    const r = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--no-pdf-header-footer', '--print-to-pdf-no-header',
      `--print-to-pdf=${pdfFile}`, pathToFileURL(path.resolve(htmlFile)).href,
    ], { encoding: 'utf8', timeout: 90_000 });
    if (!fs.existsSync(pdfFile)) return { ok: false, error: `Chrome did not write the PDF (${(r.stderr || r.error?.message || '').slice(0, 300)})` };
    return { ok: true };
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
