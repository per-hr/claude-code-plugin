---
description: Show which Plan items this session is recording to, and its time and cost in per.hr
allowed-tools: Bash(perhr:*)
---

Run `perhr status` with the Bash tool and show me its reply.

If the shell says `perhr` isn't found, run the same command with the script's full path instead of `perhr`: `${CLAUDE_PLUGIN_ROOT}/bin/perhr`, in double quotes because it may contain spaces, through the Bash tool (on Windows, write a `C:\...` path as `/c/...` with forward slashes). Don't use PowerShell for it: it's a bash script.
