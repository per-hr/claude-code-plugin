# per.hr for Claude Code

Logs your Claude Code sessions in [per.hr](https://per.hr): your time, agent time, compute and what shipped, matched to the client, project and Plan item. Sessions wait in per.hr's Work → To Review until you confirm them, so nothing reaches an invoice without you.

**Beta.** The plugin works with per.hr accounts in the AI-assisted work beta.

## Install

1. In per.hr, open **Configure → Data → Claude Code** and choose **Create a Key**.
2. In a terminal, from the folder of a repo you want recorded (outside a Claude session):
   ```
   claude plugin marketplace add per-hr/claude-code-plugin
   claude plugin install perhr@perhr --scope project
   ```
   Paste your key when Claude Code asks. The plugin is installed for that project only, so your other repos are never recorded.
3. Start Claude Code in the repo once, then connect the repo to a project on the Claude Code card in per.hr.
4. Optional, for cost, tokens and commits: add the settings block from the card to your user settings (`~/.claude/settings.json`, or `%USERPROFILE%\.claude\settings.json` on Windows).

Needs `bash`, `git` and `curl` (on Windows, the Git Bash that Claude Code uses).

## Commands

| Command | What it does |
| --- | --- |
| `/perhr:start PAY-214` | Work on a Plan item. Switching items later sends the work so far to To Review on its own. |
| `/perhr:status` | Your time, agent time and cost so far, and how much of the estimate is used. |
| `/perhr:pause` | Stop recording. `/perhr:resume` starts again. |
| `/perhr:done` | Send the session to To Review now, with a one-line summary of what shipped. |

A branch named with the reference (for example `feat/pay-214-reset`) attaches the session to that item on its own.

## What's sent

Hook events (session start and end, prompt submitted, turn finished, subagent started and stopped) with the session id, the repo's remote, folder name and branch. Prompts, code and file contents stay on your computer. per.hr discards events from repos you haven't connected.

## Guide

The full guide, including how your time is counted and how clients are billed: [per.hr/docs/claude-code](https://per.hr/docs/claude-code).

## License

MIT
