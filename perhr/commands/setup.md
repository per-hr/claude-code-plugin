---
description: Set up per.hr for AI here in Claude Code, one step at a time
allowed-tools: Bash(perhr setup:*), Bash(perhr login:*), Bash(perhr doctor:*), Bash(node:*)
---

Help me finish setting up per.hr for AI, in this chat.

1. Run `perhr setup status --json` and show me the steps as a short checklist: done, not done, or done by my team's owner. If it says this computer isn't signed in, run `perhr login --no-browser`, show me the code and the link, and tell me to approve it in my browser; then check again.
2. For the next step that isn't done, tell me in a sentence or two what it's for, then ask me for what it needs, in the chat. Then run it with flags and `--json`, and tell me the result in one line. The flags for each step:
   - work: `perhr setup --step work --work solo|shop|member`
   - account: `perhr setup --step account --note "<anything for per.hr>"`
   - business: `perhr setup --step business --business-name "…" --name "…" --address "…" --email …`
   - paid: `perhr setup --step paid --stripe`, or instructions with `--zelle`, `--venmo`, `--paypal`, `--payoneer`, `--other`
   - clients: `perhr setup --step clients --name "…" --email … --basis time|delivered --project "…"` (add `--send` to send the client's confirmation email now; ask me first)
   - claude: `perhr setup --step claude --yes` (it changes my Claude Code settings: tell me what it adds and ask me first)
   - repos: `perhr setup --step repos --project "…"` in the repo's folder (ask me which project)
   - check: `perhr setup --step check`; try: tell me how to record a first session
3. Never ask me for an hourly rate in the chat and never pass one in a command: rates are typed at the keyboard. When the business step or a project needs a rate, tell me to run `perhr setup --step business` myself in a terminal.
4. Go on to the next step until I stop, or setup is done. Then run `perhr setup status` once more and show me what's still waiting.

If the shell says `perhr` isn't found, run the same command as `node "${CLAUDE_PLUGIN_ROOT}/bin/perhr" …` through the Bash tool (on Windows, write a `C:\...` path as `/c/...` with forward slashes).
