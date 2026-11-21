// per.hr plugin: sends one Claude Code hook event to per.hr. Only the event (session id, event
// name, subagent id) plus the repo's remote, folder name and branch are sent: never prompts, code or
// file contents. per.hr records nothing for repos you haven't linked there. When per.hr can't be
// reached, events wait in ~/.perhr/queue.jsonl (never with a key) and go out, in order, with the next
// one that gets through, sent with the key this computer has then.
// While Claude uses tools, a heartbeat goes out every few minutes (PostToolUse), so a long turn isn't
// taken for a stuck one: the same fields, nothing about the tool, and it's never queued.
// The reply is printed for SessionStart, and for a prompt when per.hr sends a reminder; Claude Code
// shows it to Claude as context.
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gitRemote } from "../cli/lib/git.js";
import { repoState, stateFile, writeJsonAtomic } from "../cli/lib/config.js";

const VERSION = "0.6.0";
const HOME = process.env.PERHR_HOME || join(homedir(), ".perhr");
const QUEUE = join(HOME, "queue.jsonl");
const LOCK = join(HOME, "queue.lock");
const MAX_QUEUE = 5000;
// The heartbeat: at most one per session in this long
const BEATS = join(HOME, "beats");
const BEAT_MS = 4 * 60_000;
const env = (...names) => names.map((n) => process.env[n]).find((v) => v !== undefined && v !== "") ?? "";

async function stdin() {
  let text = "";
  for await (const c of process.stdin) text += c;
  return text;
}

/** This computer's own key (perhr login), else the key in /plugin's settings, else ~/.perhr/key */
function keyOf() {
  try {
    const c = JSON.parse(readFileSync(join(HOME, "credentials.json"), "utf8"));
    if (c?.key) return { key: c.key, own: true };
  } catch {}
  const opt = env("CLAUDE_PLUGIN_OPTION_API_KEY", "CLAUDE_PLUGIN_OPTION_api_key").trim();
  if (opt) return { key: opt, own: false };
  try {
    const k = readFileSync(join(HOME, "key"), "utf8").trim();
    if (k) return { key: k, own: false };
  } catch {}
  return null;
}

async function post(server, key, body, ms) {
  try {
    const res = await fetch(`${server}/api/agent/hooks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": `perhr-plugin/${VERSION}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    return { status: res.status, text: await res.text() };
  } catch {
    return { status: 0, text: "" };
  }
}
// Worth trying again later: per.hr unreachable, busy, or failing
const retry = (s) => s === 0 || s === 429 || s >= 500;

function lock() {
  try {
    if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > 60_000) rmSync(LOCK, { force: true });
    closeSync(openSync(LOCK, "wx"));
    return true;
  } catch {
    return false;
  }
}

function queue(item) {
  mkdirSync(HOME, { recursive: true });
  appendFileSync(QUEUE, JSON.stringify(item) + "\n", { mode: 0o600 });
  // Never let it grow without limit: the oldest go first
  const lines = readFileSync(QUEUE, "utf8").split("\n").filter(Boolean);
  if (lines.length > MAX_QUEUE) writeFileSync(QUEUE, lines.slice(-MAX_QUEUE).join("\n") + "\n", { mode: 0o600 });
}

/** Send what's waiting, oldest first; stop at the first that can't go yet. True when the queue is empty. */
async function flush(server, key) {
  if (!existsSync(QUEUE)) return true;
  if (!lock()) return false;
  try {
    const lines = readFileSync(QUEUE, "utf8").split("\n").filter(Boolean);
    let sent = 0;
    for (const line of lines.slice(0, 300)) {
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        sent++;
        continue;
      }
      const r = await post(server, key, item.body ?? item, 5000);
      if (retry(r.status)) break;
      sent++;
    }
    const rest = lines.slice(sent);
    if (rest.length) writeFileSync(QUEUE, rest.join("\n") + "\n", { mode: 0o600 });
    else rmSync(QUEUE, { force: true });
    return rest.length === 0;
  } finally {
    rmSync(LOCK, { force: true });
  }
}

/** True when this session's heartbeat is due (and marks it sent): most tool calls end here, quickly */
function beatDue(session) {
  const file = join(BEATS, createHash("sha256").update(session).digest("hex").slice(0, 16));
  const now = Date.now();
  try {
    if (now - statSync(file).mtimeMs < BEAT_MS) return false;
  } catch {}
  try {
    mkdirSync(BEATS, { recursive: true });
    writeFileSync(file, "");
    // Marks from sessions long over
    for (const f of readdirSync(BEATS)) {
      const p = join(BEATS, f);
      if (now - statSync(p).mtimeMs > 86_400_000) rmSync(p, { force: true });
    }
  } catch {
    return false;
  }
  return true;
}

async function main() {
  const k = keyOf();
  if (!k) return;
  const server = (env("PERHR_SERVER", "CLAUDE_PLUGIN_OPTION_SERVER", "CLAUDE_PLUGIN_OPTION_server") || "https://per.hr").replace(/\/+$/, "");
  let input = {};
  try {
    input = JSON.parse(await stdin());
  } catch {
    return;
  }
  const event = String(input.hook_event_name ?? "");
  const session = String(input.session_id ?? "");
  if (!event || !session) return;
  const beat = event === "PostToolUse";
  if (beat && !beatDue(session)) return;
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const g = gitRemote(dir);
  const top = g?.root ?? dir;
  const folderOnly = ["true", "1"].includes(env("CLAUDE_PLUGIN_OPTION_FOLDER_ONLY", "CLAUDE_PLUGIN_OPTION_folder_only")) || existsSync(join(HOME, "folder-only"));
  const branch = g ? gitBranch(top) : "";
  // Only yes or no: whether the prompt was one of this plugin's commands. The prompt never leaves.
  const command = event === "UserPromptSubmit" && /^\s*\/perhr:/.test(String(input.prompt ?? ""));
  const body = {
    tool: "claude-code",
    plugin: VERSION,
    command,
    remote: folderOnly ? "" : (g?.remote ?? ""),
    folder: top.split(/[\\/]/).filter(Boolean).pop() ?? "",
    branch,
    at: new Date().toISOString(),
    event: { session_id: session, hook_event_name: event, agent_id: String(input.agent_id ?? "") },
  };

  // The heartbeat: sent once, never queued (a late one says nothing), and nothing else changes
  if (beat) {
    await post(server, k.key, body, 4000);
    return;
  }

  // For the perhr command: this folder's current session, and the key its events use
  try {
    const was = repoState(top) ?? {};
    const next = { session, folderOnly, ...(k.own ? {} : { key: k.key }), at: body.at };
    if (was.session !== next.session || was.key !== next.key || was.folderOnly !== next.folderOnly) writeJsonAtomic(stateFile(top), next);
  } catch {}

  const start = event === "SessionStart";
  // Which plugin version this computer runs, for perhr doctor (the plugin and perhr are released together)
  if (start) {
    try {
      writeJsonAtomic(join(HOME, "plugin.json"), { version: VERSION, at: body.at }, 0o644);
    } catch {}
  }
  // Anything waiting goes first, so per.hr sees events in the order they happened
  const clear = await flush(server, k.key);
  if (!clear) {
    queue({ body });
    if (start) out("per.hr can't be reached right now, so this session's events are being saved on this computer and will be sent when it's back. Tell the person this once, then carry on with their task.");
    return;
  }
  const r = await post(server, k.key, body, start ? 8000 : 6000);
  if (retry(r.status)) {
    queue({ body });
    if (start) out("per.hr can't be reached right now, so this session's events are being saved on this computer and will be sent when it's back. Tell the person this once, then carry on with their task.");
    return;
  }
  // per.hr's reply reaches Claude as context: at session start, and with a prompt when per.hr has a
  // reminder (the running summary). A refusal is shown only at session start.
  if (r.text && (start || (event === "UserPromptSubmit" && r.status === 200))) out(withCommand(r.text, top));
}

function gitBranch(top) {
  try {
    const b = String(execGit(["rev-parse", "--abbrev-ref", "HEAD"], top)).trim();
    return b === "HEAD" ? "" : b;
  } catch {
    return "";
  }
}

import { execFileSync } from "node:child_process";
const execGit = (args, cwd) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });

/** per.hr writes {{PERHR}} where Claude should run the perhr command: its full path, and this repo */
function withCommand(text, top) {
  if (!text.includes("{{PERHR}}")) return text;
  const root = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
  const slash = (p) => p.replace(/\\/g, "/");
  return text.split("{{PERHR}}").join(`node "${slash(join(root, "bin", "perhr"))}" --repo "${slash(top)}"`);
}

const out = (s) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);

main().catch(() => {}).finally(() => process.exit(0));
