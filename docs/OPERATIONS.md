# Operations

## Upgrade a client to a new kit version
```bash
cd ~/openclaw-job-agents && git pull
./install/install.sh --only files,agents,config
openclaw gateway restart
```
Client data (`~/jobsquad/client`, `data`, `applications`, `reports`) is never overwritten. Agent instruction files are refreshed. `USER.md` is kept once the Chief has written to it.

## Change the schedule or chat target
```bash
./install/install.sh --only schedule --deliver-channel telegram --deliver-to <chat-id>
openclaw automations list
```
To change times, edit the `add(...)` lines in `install/setup.mjs`, or use `openclaw automations edit <id> --cron "0 9 * * 1-5"`.

## Back up
```bash
openclaw backup create                       # OpenClaw config, sessions, workspaces
tar czf jobsquad-$(date +%F).tgz -C ~ jobsquad   # client data, tracker, applications
```
The tracker is a single SQLite file: `~/jobsquad/data/jobsquad.db`.

## Troubleshooting
| Symptom | Check |
|---|---|
| No digest arrived | `openclaw automations list`, `openclaw automations runs <id>`, `openclaw logs` |
| Digest arrives but is empty | `jobsquad stats`: look at the top filter reasons. Widen titles or locations, or add boards. |
| A board keeps failing | `jobsquad boards list`. A wrong token or a company that moved ATS: `jobsquad boards remove <ats> <token>` |
| Agent asks for approval to run jobsquad | Re-run `./install/install.sh --only approvals`, or approve once with "allow always" |
| PDFs not created | `jobsquad doctor` shows the PDF renderer. Install Chrome or set `CHROME_PATH`. |
| Many needs_human on one site | It needs accounts or CAPTCHAs. Add its ATS to `requires_human_ats`, or exclude the company. |
| QA keeps failing on a real skill | The master résumé is missing it. Add it there (it's true, so it belongs). Use `writing.allow_terms` only as a last resort. |
| Messages go to the wrong agent | `openclaw agents bindings`. The client's channel must route to job-chief. |

Useful commands:
```bash
~/jobsquad/bin/jobsquad help
~/jobsquad/bin/jobsquad list --status needs_human
~/jobsquad/bin/jobsquad show 42 && ~/jobsquad/bin/jobsquad log 42
openclaw agent --agent job-chief --message "status"
```

## Several clients on one machine (testing or agency use)
Each client needs its own OpenClaw profile and data folder:
```bash
./install/install.sh --profile client-b --home ~/jobsquad-client-b --client-name "B Person" ...
openclaw --profile client-b gateway run     # each profile runs its own gateway
```
For production, one client per computer is simpler and keeps browser sessions separate.

## Uninstall
```bash
./install/install.sh --uninstall            # removes agents and automations; keeps ~/jobsquad
./install/install.sh --uninstall --purge    # also deletes ~/jobsquad (applications, tracker)
```
Agent workspaces go to the system Trash rather than being hard-deleted.
