---
description: Same as /perhr:end (its older name). End this session in per.hr with a summary for the client
allowed-tools: Bash(perhr:*)
---

Write a summary of what this session accomplished, for the client who pays for the work: one to three plain sentences about the result (what now works or changed), with no file names, code, internal details or secrets. If I added notes after the command, use them: $ARGUMENTS

Show me the summary, then run `perhr end "<the summary>"` with the Bash tool and tell me its reply in one line. Mention once that `/perhr:end` is the command's new name.

If the shell says `perhr` isn't found, run the same command with the script's full path instead of `perhr`: `${CLAUDE_PLUGIN_ROOT}/bin/perhr`, in double quotes because it may contain spaces, through the Bash tool (on Windows, write a `C:\...` path as `/c/...` with forward slashes). Don't use PowerShell for it: it's a bash script.
