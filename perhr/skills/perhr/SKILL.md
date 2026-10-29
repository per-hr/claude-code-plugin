---
name: perhr
description: How per.hr records this Claude Code session for billing. Use when the person mentions per.hr, a Plan item reference (like PAY-214), billing, their time, or asks what to work on next.
---

# per.hr

per.hr records this session for the person's time tracking and invoicing: their own attended time, agent time, compute and what shipped. Only repos they connected in per.hr are recorded. Prompts and code are never sent.

- Work belongs to a **Plan item** with a reference such as `PAY-214`. A branch named with the reference (`feat/pay-214-reset`) attaches the session automatically. Otherwise run `perhr start <ref>` (or the person runs `/perhr:start <ref>`).
- `perhr status` shows the person's time, agent time and cost so far, and how much of the item's estimate is used.
- When the work is done, suggest `/perhr:done`. Write the summary for the client: the result in plain words, with no file names, code or internal details.
- Never claim time or mark work billable on the person's behalf: per.hr holds every session for them to confirm in Work → To Review.
- If the session start says this repo isn't connected, tell the person once and carry on with their task.
