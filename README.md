# JobSquad for OpenClaw

A team of six [OpenClaw](https://openclaw.ai) agents that finds jobs, scores them against a candidate's real experience, tailors truthful application documents, and applies, with the candidate approving every submission by default.

It's built to be installed on a client's own computer (macOS, Linux or Windows) and run there day to day, in a chat window on the computer or in the chat app the client already uses (Telegram, WhatsApp, Discord, Slack, …).

> **🍎 New to this? On a Mac:** open **Terminal** (⌘ Space, type "Terminal"), paste this line, press Return, and answer the questions. No technical knowledge needed.
> ```bash
> curl -fsSL https://raw.githubusercontent.com/celiksuakd/openclaw-job-agents/main/install/get.sh | bash
> ```
> Prefer to download the ZIP? See [docs/MAC-START-HERE.md](docs/MAC-START-HERE.md); macOS asks you to allow it once in System Settings.

```
07:30–08:00  Chief fetches ~3,000 postings from public job-board APIs → cheap filter keeps ~30
             Matcher scores them → Chief sends the client a digest:
               #2747 · 88 · Software Engineer – Query Engines — Palantir · London
               Reply "approve 2747" or "skip 2747"
client       "approve 2747"
             Writer tailors résumé + letter (QA blocks anything not in the master résumé)
             can-apply gate checks mode, approval, daily cap, domain rules
             Applier fills the Lever form, submits once, saves a screenshot
             Chief: "✓ Applied: Software Engineer – Query Engines, Palantir"
```

## The agents

| Agent | Role | Tools it may NOT use |
|---|---|---|
| **job-chief** 🧭 | Talks to the client, runs the daily routine, delegates, enforces the rules | browser |
| **job-scout** 🔭 | Pulls postings, discovers company boards, resolves forwarded links | browser, message |
| **job-matcher** 🎯 | Scores postings 0–100 with a fixed rubric and hard gates | browser, message |
| **job-writer** ✍️ | Tailors résumé, cover letter and screening answers from the master résumé | browser, message |
| **job-applier** 📮 | Fills one application in OpenClaw's isolated browser; submits only when allowed | message |
| **job-tracker** 📈 | Follow-up drafts, ghosted detection, weekly report and CSV | browser, message |

They share one deterministic CLI, `jobsquad` (SQLite tracker, job fetchers, QA, the apply gate), so state and the rules live in code rather than in model memory. Details: [docs/DESIGN.md](docs/DESIGN.md).

## Safety by design
- **Truth lock:** the writer may only reuse facts from `master_resume.md`. `jobsquad qa` mechanically fails any tailored résumé that names a tool, employer or number missing from it.
- **Apply gate:** `jobsquad can-apply` checks mode, client approval, QA, a daily cap, a per-company cap, duplicates and blocked domains. Agents can't submit without an ALLOW.
- **Human-only steps:** no account creation, no passwords, no CAPTCHA solving, no LinkedIn/Indeed automation. Those become "needs you" items with a link.
- **Audit trail:** every status change, approval (with the client's own words) and gate decision is logged; a screenshot is kept for every submission.
- **Modes:** `review` (default: client approves each job), `assist` (forms filled, client clicks Submit), `auto` (high-scoring jobs on simple ATSs only, within caps).

## Install on a client's computer

**Mac, guided (for non-technical users):** run this in Terminal (or double-click `Install JobSquad.command` from the ZIP; macOS then needs a one-time **Open Anyway** in System Settings → Privacy & Security, because the file isn't notarized):
```bash
curl -fsSL https://raw.githubusercontent.com/celiksuakd/openclaw-job-agents/main/install/get.sh | bash
```
It checks that OpenClaw is installed, connected to an AI account and running (and fixes what it can), asks plain-language questions, imports the CV from PDF or Word, sets up the team and schedule, and puts a **JobSquad** chat icon on the Desktop. Morning digests appear in that chat with a Mac notification; no Telegram setup is needed. The job seeker's guide is [docs/HOW-TO-USE.md](docs/HOW-TO-USE.md).

**Manual / any OS (for operators):**

1. Install OpenClaw and connect a model and the client's chat channel:
   ```bash
   curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install.sh | bash
   openclaw onboard --install-daemon
   ```
   Windows (PowerShell): `iwr -useb https://openclaw.ai/install.ps1 | iex`, then the same `onboard` command.
2. Get this kit and run the installer:
   ```bash
   git clone https://github.com/<you>/openclaw-job-agents.git && cd openclaw-job-agents
   ./install/install.sh --client-name "Jane Doe" --timezone Europe/Istanbul \
     --bind telegram:* --deliver-channel telegram --deliver-to <chat-id>
   ```
   Windows: `.\install\install.ps1 --client-name "Jane Doe" ...` (same options).
3. Fill in `~/jobsquad/client/` (master résumé, answers, search settings), or let job-chief interview the client in chat.
4. `openclaw gateway restart`, then say "hi" to the bot.

The full per-client runbook with an intake checklist is in [docs/CLIENT-SETUP.md](docs/CLIENT-SETUP.md). For upgrades, backups, troubleshooting and uninstalling, see [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Job sources (official public APIs only)
Company boards: **Greenhouse, Lever, Ashby, Workable, SmartRecruiters**. Feeds: **Remotive, RemoteOK, Arbeitnow, Himalayas**. The Scout keeps adding company boards it discovers through web search. LinkedIn and Indeed links the client forwards are matched to the company's own posting.

## Requirements
- OpenClaw 2026.9 or later (tested on 2026.9.8), with its bundled Node 22.13+ (uses `node:sqlite`; no npm dependencies)
- Google Chrome, Chromium or Edge (OpenClaw's browser, also used to render PDFs)
- A model with tool use. The Writer and Chief benefit from a strong model; Scout, Matcher and Tracker can use a cheaper one (`--fast-model`).

## Development
```bash
npm test               # offline end-to-end test of the CLI
npm run test:online    # also hits a live Greenhouse board
```

## Responsible use
You are responsible for following each job site's terms, local employment and privacy law (e.g. GDPR/KVKK), and for being honest with your clients about what is automated. Keep the candidate in the loop: the defaults are deliberately conservative.

## License
[MIT](LICENSE)
