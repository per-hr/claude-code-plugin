---
name: perhr
description: How per.hr records this Claude Code session for billing, and the perhr command. Use when the person mentions per.hr, a Plan item reference (like PAY-214), billing, invoices, clients, their time, or asks what to work on next.
---

# per.hr

per.hr records this session for the person's time tracking and invoicing: their own attended time, agent time, compute and what shipped. Only repos they linked in per.hr are recorded. Prompts and code are never sent.

- Work belongs to a **Plan item** with a reference such as `PAY-214`. A branch named with the reference (`feat/pay-214-reset`) attaches the session automatically. Otherwise run `perhr start <ref>` (or the person runs `/perhr:start <ref>`).
- `perhr status` shows this session's items, time and cost, and anything waiting on the person.
- If the session start asked for notes (no Plan item), run the `note` command it gave after each finished piece of work: one or two plain sentences on what changed and in which repo, replacing the last note.
- When the work on the item is finished, suggest `/perhr:end`. Write the summary for the client: the result in plain words, with no file names, code or internal details, and never a mention of Claude, AI, agents or the tools used (the client sees it on their invoice).
- `perhr` also lists and changes clients, projects, repos, time, Plan items, To Review and invoices (`perhr help`). Reads run freely. Every change shows Claude Code's own prompt first. Sending an invoice is approved on per.hr in the browser.
- Print money and hours exactly as `perhr` prints them. Never restate or recompute them.
- Never ask for, type or pass an hourly rate: rates are typed by the person in a terminal.
- Never claim time or mark work billable on the person's behalf: per.hr holds every session for them to confirm in To Review.
- If the session start says this repo isn't linked, or that per.hr can't be reached, tell the person once and carry on with their task.
