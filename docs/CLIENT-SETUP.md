# Setting up a new client

Plan about 45 minutes: 15 on the machine, 30 on the intake with the client.

## Before the session: intake checklist
Ask the client to bring:
- [ ] Their current résumé (PDF) and, ideally, a long "everything I've done" version: all jobs, tools, real numbers
- [ ] LinkedIn / GitHub / portfolio URLs
- [ ] Target titles (2–5), places (cities, countries, remote), and companies to avoid
- [ ] Work authorization per country, and willingness to relocate
- [ ] Salary floor and target (currency, annual)
- [ ] Notice period / earliest start date
- [ ] Which chat app they want updates in (Telegram is easiest)
- [ ] Mode: start with **review**. Explain assist and auto.
- [ ] Written consent: what the agents do on their behalf, the data processing involved, and that they approve applications

## On the client's computer
1. **OpenClaw:** install it, then run `openclaw onboard --install-daemon`. Add model auth and connect the chat channel. Check with `openclaw status`.
2. **Chrome:** make sure Google Chrome (or Chromium/Edge) is installed, then run `openclaw browser start` once.
3. **Kit:**
   ```bash
   git clone https://github.com/<you>/openclaw-job-agents.git ~/openclaw-job-agents
   cd ~/openclaw-job-agents
   ./install/install.sh \
     --client-name "Jane Doe" --timezone Europe/Istanbul --language en \
     --resume ~/Downloads/Jane_Doe_CV.pdf \
     --bind telegram:* --deliver-channel telegram --deliver-to <chat-id> \
     --fast-model anthropic/claude-sonnet-5-5
   ```
   To find the chat id, use `openclaw directory` (see `openclaw directory --help`) after the client has messaged the bot once.
4. **Client files** in `~/jobsquad/client/`:
   - `master_resume.md`: paste everything. Long is good. This is the truth source; the Writer can only remove and reorder.
   - `answers.jsonc`: identity, work authorization, salary, EEO choices, consent.
   - `client.jsonc`: titles, locations, sources. Add 10–30 target companies' board tokens if you know them; the Scout adds more every Monday.
   - Run `~/jobsquad/bin/jobsquad doctor` until everything shows ✓.
5. Run `openclaw gateway restart`.

## First run, together with the client
1. The client messages the bot: "hi". The Chief runs SETUP_CHECK and asks for anything missing.
2. You trigger a run: `openclaw agent --agent job-chief --message "DAILY_RUN"`.
3. Walk the client through the digest. Have them approve one job and watch the application go through. Show them `applications/<id>/evidence/`.
4. Agree on the routine: the digest arrives weekdays at 08:00; they answer with approve/skip; a weekly report comes on Friday.

## Choosing the mode
| Client says | Mode |
|---|---|
| "I want to see everything first" | `review` (default) |
| "Fill it in, I'll press Submit" (cautious, or many Workday jobs) | `assist` |
| "Just apply to the good ones" (after 1–2 weeks of review with good scores) | `auto` with `min_score_auto_apply` 85+ and a modest daily cap |

## Handover note for the client
- Answer the digest with `approve 12 15`, `skip 13 too junior`, or forward any job link.
- "needs you" items: open the link and finish the step the bot names (login, CAPTCHA, a specific question).
- Tell the bot about interviews and rejections. It keeps the tracker right and tunes the search.
- "pause" / "resume" at any time.
