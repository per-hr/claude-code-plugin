#!/usr/bin/env node
import { ApiError, exitCodeOf, setRepo, VERSION } from "../lib/api.js";
import { COMMANDS, SESSION, session } from "../lib/commands.js";
import { closeQuestions, cyan, dim, err, out, parseArgs, red, typed, UsageError } from "../lib/ui.js";
import { maybeCheck, notice, updateCommand } from "../lib/update.js";

const HELP = `perhr ${VERSION}: bill clients for your Claude Code and Codex work, from the terminal

Get started
  npx perhr setup            Set up per.hr for AI, step by step
  perhr setup status         What's done and what's next
  perhr setup --step codex   Add per.hr's hooks to Codex (--remove takes them out)
  perhr login | logout       Sign this computer in or out (approve at per.hr/device)
  perhr whoami | status      Who you are, and what's waiting
  perhr doctor               Check the connection
  perhr update [--on|--off]  Install a newer perhr now, or turn daily updates on or off
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
Docs: ${"https://per.hr/docs/claude-code"} · Codex: ${"https://per.hr/ai/codex"}`;

async function main() {
  const argv = process.argv.slice(2);
  const { flags, pos } = parseArgs(argv);
  // --repo <folder>: the session-start note gives Claude this, so a command lands on the right session from any folder
  if (typeof flags.repo === "string" && ["start", "pause", "resume", "end", "done", "note", "status"].includes(pos[0])) setRepo(flags.repo);
  const [cmd, ...rest] = pos;
  // Codex's hook, run by hand (Codex itself runs the copy perhr setup --step codex puts in ~/.perhr/codex)
  if (cmd === "hook" && rest[0] === "codex") return (await import("../lib/codex-hook.js")).run();
  if (flags.version || cmd === "version") return out(VERSION);
  if (!cmd || flags.help || cmd === "help") return out(HELP);
  if (cmd === "update") {
    const r = await updateCommand(rest, flags);
    if (flags.json && r !== undefined) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    return;
  }
  // Once a day, a background check for a newer perhr (never for uninstall, which takes per.hr off)
  if (cmd !== "uninstall") maybeCheck();
  let result;
  if (SESSION.has(cmd)) result = await session(cmd, rest, flags);
  else if (COMMANDS[cmd]) result = await COMMANDS[cmd](rest, flags);
  else throw new UsageError(`Unknown command: ${cmd}. See perhr help.`);
  if (flags.json && result !== undefined) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

/** A line about updates after a command, even one that failed (never with --json, in the status line or after uninstall) */
function updateNotice() {
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => !a.startsWith("-"));
  if (!cmd || argv.includes("--json") || ["statusline", "uninstall", "update", "hook", "help", "version"].includes(cmd)) return;
  notice();
}

main()
  .then(() => {
    closeQuestions();
    updateNotice();
  })
  .catch((e) => {
    closeQuestions();
    updateNotice();
    const json = process.argv.includes("--json");
    if (e instanceof UsageError) {
      if (json) process.stdout.write(JSON.stringify({ error: { code: "usage", message: e.message } }) + "\n");
      else err(red(e.message));
      process.exit(2);
    }
    if (e instanceof ApiError) {
      // The command that fixes it, as this person can type it (npx perhr … when there's no perhr on the PATH)
      const fix = e.fix ? typed(e.fix) : undefined;
      if (json) process.stdout.write(JSON.stringify({ error: { code: e.code, message: e.message, ...(fix ? { fix } : {}) } }) + "\n");
      else err(`${red(e.message)}${fix ? `\n${dim("Next:")} ${cyan(fix)}` : ""}`);
      process.exit(exitCodeOf(e));
    }
    if (json) process.stdout.write(JSON.stringify({ error: { code: "error", message: e.message } }) + "\n");
    else err(red(e.message));
    process.exit(1);
  });
