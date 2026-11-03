---
description: Work on per.hr Plan items in this session (PAY-214, a range PAY-214:216, or a list PAY-214+PAY-220)
argument-hint: <ref, range or list>
allowed-tools: Bash(perhr:*)
---

Run `perhr start "$ARGUMENTS"` with the Bash tool and tell me its reply in one line. If no reference was given, ask me which Plan item.

If the shell says `perhr` isn't found, run the same command with the script's full path instead of `perhr`: `${CLAUDE_PLUGIN_ROOT}/bin/perhr`, in double quotes because it may contain spaces, through the Bash tool (on Windows, write a `C:\...` path as `/c/...` with forward slashes). Don't use PowerShell for it: it's a bash script.
