#!/usr/bin/env node
import { ApiError, exitCodeOf, setRepo, VERSION } from "../lib/api.js";
import { COMMANDS, SESSION, session } from "../lib/commands.js";
import { closeQuestions, cyan, dim, err, out, parseArgs, red, UsageError } from "../lib/ui.js";

const HELP = `perhr ${VERSION}: bill clients for your Claude Code work, from the terminal

Get started
  npx perhr setup            Set up per.hr for AI, step by step
  perhr setup status         What's done and what's next
  perhr login | logout       Sign this computer in or out (approve at per.hr/device)
  perhr whoami | status      Who you are, and what's waiting
  perhr doctor               Check the connection
  perhr uninstall            Take per.hr off this computer (your account and data stay)
  perhr keys                 Computers and keys; perhr keys disconnect <id>
  perhr workspace [use <name>]

Work
  perhr client list | add | show | edit | emails | archive
  perhr project list | add
  perhr repo list | link [--project <name>]
  perhr time list | log <hours> --project <name>
  perhr plan list | add <title> --project <name> [--estimate 2]
  perhr review | review confirm <id> | dismiss <id> | undo <id>
  perhr invoice list | new <client> | preview <INV> | open <INV> | send <INV…> | remind <INV> | mark-sent | mark-paid
  perhr estimate list | preview <EST> | open <EST> | send <EST>

Teams (in a team: perhr workspace use <team>)
  perhr team list | invite <email> --role member|admin|viewer | cancel <email> | role <person> <role> | remove <person>
  perhr timesheets [--week YYYY-MM-DD] | approve <person> | approve --all | send-back <person> --note … | submit
  perhr pay | pay file [--out payouts.csv] | pay open

Sessions (also /perhr:start and the rest in Claude Code)
  perhr start <Plan item> | pause | resume | end | done | note <text>

Every command takes --json. Writes take --dry-run. Rates are typed at the keyboard.
Sends are approved in your browser on per.hr; --test sends a copy to you only.
Docs: ${"https://per.hr/docs/claude-code"}`;

async function main() {
  const argv = process.argv.slice(2);
  const { flags, pos } = parseArgs(argv);
  // --repo <folder>: the session-start note gives Claude this, so a command lands on the right session from any folder
  if (typeof flags.repo === "string" && ["start", "pause", "resume", "end", "done", "note", "status"].includes(pos[0])) setRepo(flags.repo);
  const [cmd, ...rest] = pos;
  if (flags.version || cmd === "version") return out(VERSION);
  if (!cmd || flags.help || cmd === "help") return out(HELP);
  let result;
  if (SESSION.has(cmd)) result = await session(cmd, rest, flags);
  else if (COMMANDS[cmd]) result = await COMMANDS[cmd](rest, flags);
  else throw new UsageError(`Unknown command: ${cmd}. See perhr help.`);
  if (flags.json && result !== undefined) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main()
  .then(() => {
    closeQuestions();
  })
  .catch((e) => {
    closeQuestions();
    const json = process.argv.includes("--json");
    if (e instanceof UsageError) {
      if (json) process.stdout.write(JSON.stringify({ error: { code: "usage", message: e.message } }) + "\n");
      else err(red(e.message));
      process.exit(2);
    }
    if (e instanceof ApiError) {
      if (json) process.stdout.write(JSON.stringify({ error: { code: e.code, message: e.message, ...(e.fix ? { fix: e.fix } : {}) } }) + "\n");
      else err(`${red(e.message)}${e.fix ? `\n${dim("Next:")} ${cyan(e.fix)}` : ""}`);
      process.exit(exitCodeOf(e));
    }
    if (json) process.stdout.write(JSON.stringify({ error: { code: "error", message: e.message } }) + "\n");
    else err(red(e.message));
    process.exit(1);
  });
