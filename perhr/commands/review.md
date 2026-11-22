---
description: What's waiting in per.hr's Review, to confirm, dismiss or fix
allowed-tools: Bash(perhr review:*), Bash(node:*)
---

Run `perhr review` with the Bash tool and show me its reply as it is. If I ask to confirm or dismiss a session, run `perhr review confirm <id>` or `perhr review dismiss <id>` (Claude Code asks me first). Don't restate hours or money in your own words.

If the shell says `perhr` isn't found, run the same command as `node "${CLAUDE_PLUGIN_ROOT}/bin/perhr" …` through the Bash tool (on Windows, write a `C:\...` path as `/c/...` with forward slashes).
