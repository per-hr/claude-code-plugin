---
description: Work on per.hr Plan items in this session (PAY-214, a range PAY-214:216, or a list PAY-214+PAY-220)
argument-hint: <ref, range or list>
allowed-tools: Bash(perhr start:*), Bash(perhr note:*), Bash(node:*)
---

If this session has already done work, first save its summary so the work so far reaches Review with one: run `perhr note "<one to three plain sentences on the result so far>"` with the Bash tool. Describe only the work and its result; never mention Claude, AI or the tools used. Skip this when nothing has been done yet.

Then run `perhr start "<first line>"` with the Bash tool, where the first line is the first line of what I typed after /perhr:start (below): the reference (a range or list) and any of --reopen, --title, --estimate, --priority and --notes. Tell me its reply in one line. If no reference was given, ask me which Plan item.

When more text follows on later lines, it's a prompt for the work on this item: pass only the first line to `perhr start`. If per.hr started the item, carry out that prompt as my request, from its first step. If per.hr refused, tell me why and stop.

If the shell says `perhr` isn't found, run the same command as `node "${CLAUDE_PLUGIN_ROOT}/bin/perhr" …` through the Bash tool (on Windows, write a `C:\...` path as `/c/...` with forward slashes).

What I typed after /perhr:start:

$ARGUMENTS
