# Setting up JobSquad on a Mac (no experience needed)

You need a Mac with **OpenClaw** installed and set up (opened at least once and connected to an AI account such as Claude or ChatGPT). If you haven't done that yet, do it first at [openclaw.ai](https://openclaw.ai). The JobSquad installer will also help you if something is missing.

You also need **Google Chrome** installed. JobSquad uses it to fill in applications and make PDF CVs.

Have your CV ready (PDF or Word).

---

## Option A: one line in Terminal (recommended, no warnings)

1. Open **Terminal**: press **⌘ Command + Space**, type `Terminal`, press **Return**.
2. Copy this line, paste it into Terminal (**⌘ Command + V**), and press **Return**:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/celiksuakd/openclaw-job-agents/main/install/get.sh | bash
   ```
3. Questions appear: your name, the jobs you want, where you can work. Type each answer and press **Return**.
4. When it asks for your CV, a file window opens. Pick your CV and click **Choose**.
5. When it's done, your browser opens the JobSquad chat. Type **Hi** and press Return.

## Option B: download the ZIP

1. On the GitHub page, click the green **Code** button, then **Download ZIP**, and double-click the ZIP in **Downloads** to unpack it.
2. Double-click **Install JobSquad** in the unpacked folder. macOS says *"Apple could not verify 'Install JobSquad.command' is free of malware…"*. Click **Done** (not "Move to Trash").
3. Open the **Apple menu  → System Settings → Privacy & Security**, and scroll down to the **Security** section.
4. Next to *"Install JobSquad.command" was blocked…*, click **Open Anyway**, and confirm with your password or Touch ID.
5. Double-click **Install JobSquad** again and click **Open Anyway** once more. Then continue from step 3 of Option A.

You only do this once. macOS shows this warning for any app from outside the App Store that isn't registered with Apple; it doesn't mean anything was found. If you'd rather skip it, use Option A.

---

## What happens during setup
| You'll see | What it means |
|---|---|
| "Checking OpenClaw" | Makes sure OpenClaw is installed, connected to an AI account, and running. If it isn't connected, OpenClaw's own setup opens. Pick the quick start. |
| Questions 1–6 | Your details for application forms, the jobs you want, work permits, salary, and how independent JobSquad should be. |
| "Installing JobSquad" | Creates the six assistants and the daily schedule. About a minute. |
| "Looking for jobs for the first time" | A first search, to check everything works. |
| Browser opens a chat | This is JobSquad. Say hi. |

Afterwards you'll find two new things on your Desktop:
- **JobSquad**: double-click it to open the chat.
- **JobSquad Files**: your CV copies, every application sent (with screenshots), and weekly reports.

## Something went wrong?
| Problem | Fix |
|---|---|
| "Apple could not verify … is free of malware" | Use Option A (Terminal), or follow Option B's **Open Anyway** steps in System Settings → Privacy & Security. |
| "OpenClaw isn't installed" | Install it from openclaw.ai, open it once, then run Install JobSquad again. |
| "isn't connected to an AI account" | Follow the OpenClaw setup that opens. You need a Claude or ChatGPT account, or an API key. |
| The chat page says it can't connect | Double-click the **JobSquad** icon on the Desktop. It starts OpenClaw if needed. |
| No messages in the morning | The Mac must be on and awake around 08:00 on weekdays. Open the chat and type "status". |
| Anything else | Run the setup again (the Terminal line, or Install JobSquad). It's safe and keeps your data. Or ask in the chat: "something isn't working". |

## Removing JobSquad
Open Terminal and run:
```bash
~/JobSquad-kit/install/install.sh --uninstall
```
If you used the ZIP, run `install/install.sh --uninstall` from that folder instead. Your files in "JobSquad Files" are kept unless you add `--purge`.
