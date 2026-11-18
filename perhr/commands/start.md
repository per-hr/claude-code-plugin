---
description: Work on per.hr Plan items in this session (PAY-214, a range PAY-214:216, or a list PAY-214+PAY-220)
argument-hint: <ref, range or list>
allowed-tools: Bash(perhr start:*), Bash(node:*)
---

Run `perhr start "$ARGUMENTS"` with the Bash tool and tell me its reply in one line. If no reference was given, ask me which Plan item.

If the shell says `perhr` isn't found, run the same command as `node "${CLAUDE_PLUGIN_ROOT}/bin/perhr" …` through the Bash tool (on Windows, write a `C:\...` path as `/c/...` with forward slashes).
