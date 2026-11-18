---
description: End this session in per.hr: the work is finished. Sends it to To Review with a summary for the client
allowed-tools: Bash(perhr end:*), Bash(node:*)
---

Write a summary of what this session accomplished, for the client who pays for the work: one to three plain sentences about the result (what now works or changed), with no file names, code, internal details or secrets. Describe the work itself: never mention Claude, AI, agents or the tools used, since the client sees this on their invoice. If I added notes after the command, use them: $ARGUMENTS

Show me the summary, then run `perhr end "<the summary>"` with the Bash tool and tell me its reply in one line.

If the shell says `perhr` isn't found, run the same command as `node "${CLAUDE_PLUGIN_ROOT}/bin/perhr" …` through the Bash tool (on Windows, write a `C:\...` path as `/c/...` with forward slashes).
