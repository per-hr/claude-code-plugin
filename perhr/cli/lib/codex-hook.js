// per.hr's hook for Codex: sends one Codex hook event to per.hr. The same fields the Claude Code plugin
// sends (the session id, the event, a subagent's id, the repo's remote, folder name and branch) and,
// since Codex has no telemetry, its token counts by model: added up on this computer as each model
// request finishes, and sent with the end of the turn. Never prompts, code, tool input or output, or
// Codex's replies.
//
// Codex waits for its hooks, so only the session's start talks to per.hr while Codex waits. Everything
// else is handed to a copy of this script running in the background, and Codex carries on at once.
// When per.hr can't be reached, events wait in ~/.perhr/queue.jsonl (never with a key), shared with the
// Claude Code plugin, and go out in order with the next one that gets through.
//
// `perhr setup --step codex` copies this file, config.js and git.js to ~/.perhr/codex and points
// Codex's hooks.json at ~/.perhr/codex/hook.mjs. Codex asks the person to trust the hooks first.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { gitRemote } from "./git.js";
import { DIR, repoState, stateFile, writeJsonAtomic } from "./config.js";

export const HOOK_VERSION = "0.9.0";
const QUEUE = join(DIR, "queue.jsonl");
const LOCK = join(DIR, "queue.lock");
const MAX_QUEUE = 5000;
const USAGE = join(DIR, "codex-usage");
const BEATS = join(DIR, "beats");
const BEAT_MS = 4 * 60_000;
// Written each time the hook runs: perhr doctor reads it to tell that Codex trusted the hooks
export const HEARD = join(DIR, "codex", "heard.json");
// The events that close a turn carry the token counts added up since the last one
const CARRY = new Set(["Stop", "SubagentStop", "SessionEnd"]);
const SENT = new Set(["SessionStart", "UserPromptSubmit", "Stop", "SubagentStart", "SubagentStop", "SessionEnd", "PostToolUse"]);

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const n = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** This computer's own key (perhr login). Codex is set up only after signing in. */
function keyOf() {
  if (process.env.PERHR_KEY) return process.env.PERHR_KEY.trim();
  try {
    return JSON.parse(readFileSync(join(DIR, "credentials.json"), "utf8"))?.key ?? null;
  } catch {
    return null;
  }
}

const server = () => {
  if (process.env.PERHR_API) return process.env.PERHR_API.replace(/\/+$/, "");
  try {
    return (JSON.parse(readFileSync(join(DIR, "config.json"), "utf8"))?.api || "https://per.hr").replace(/\/+$/, "");
  } catch {
    return "https://per.hr";
  }
};

async function post(key, body, ms) {
  try {
    const res = await fetch(`${server()}/api/agent/hooks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": `perhr-codex/${HOOK_VERSION}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    return { status: res.status, text: await res.text() };
  } catch {
    return { status: 0, text: "" };
  }
}
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

function queue(body) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(QUEUE, JSON.stringify({ body }) + "\n", { mode: 0o600 });
  const lines = readFileSync(QUEUE, "utf8").split("\n").filter(Boolean);
  if (lines.length > MAX_QUEUE) writeFileSync(QUEUE, lines.slice(-MAX_QUEUE).join("\n") + "\n", { mode: 0o600 });
}

/** Send what's waiting, oldest first; stop at the first that can't go yet. True when the queue is empty. */
async function flush(key) {
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
      const r = await post(key, item.body ?? item, 5000);
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

/** True when this session's heartbeat is due (and marks it sent) */
function beatDue(session) {
  const file = join(BEATS, hash(`codex:${session}`));
  const now = Date.now();
  try {
    if (now - statSync(file).mtimeMs < BEAT_MS) return false;
  } catch {}
  try {
    mkdirSync(BEATS, { recursive: true });
    writeFileSync(file, "");
    for (const f of readdirSync(BEATS)) {
      const p = join(BEATS, f);
      if (now - statSync(p).mtimeMs > 86_400_000) rmSync(p, { force: true });
    }
  } catch {
    return false;
  }
  return true;
}

/** One model request's tokens, kept until the turn ends. Input here excludes cached input. */
function addUsage(session, ev) {
  const u = ev.token_usage;
  const model = String(ev.model ?? "").trim().slice(0, 80);
  if (!u || typeof u !== "object" || !model) return;
  const cachedRead = n(u.cached_input_tokens);
  const cachedWrite = n(u.cache_write_input_tokens);
  const line = { model, input: Math.max(0, n(u.input_tokens) - cachedRead - cachedWrite), cached: cachedRead + cachedWrite, output: n(u.output_tokens) };
  if (!line.input && !line.cached && !line.output) return;
  mkdirSync(USAGE, { recursive: true });
  appendFileSync(join(USAGE, `${hash(session)}.jsonl`), JSON.stringify(line) + "\n", { mode: 0o600 });
}

/** Everything added up since the last report, by model, and cleared (it travels in the event from now on) */
function takeUsage(session) {
  const file = join(USAGE, `${hash(session)}.jsonl`);
  if (!existsSync(file)) return null;
  const taking = `${file}.${process.pid}`;
  try {
    renameSync(file, taking);
  } catch {
    return null;
  }
  const by = {};
  for (const l of readFileSync(taking, "utf8").split("\n").filter(Boolean)) {
    try {
      const x = JSON.parse(l);
      const m = (by[x.model] ??= { input: 0, cached: 0, output: 0 });
      m.input += n(x.input);
      m.cached += n(x.cached);
      m.output += n(x.output);
    } catch {}
  }
  rmSync(taking, { force: true });
  return Object.keys(by).length ? by : null;
}

function gitBranch(top) {
  try {
    const b = String(execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: top, stdio: ["ignore", "pipe", "ignore"] })).trim();
    return b === "HEAD" ? "" : b;
  } catch {
    return "";
  }
}

/**
 * Codex can't reach per.hr from its sandbox, so per.hr asks it to end a reply with "per.hr note: …"
 * (and "per.hr start: AUD-12" to start a Plan item). Only those lines are taken from the end of the
 * turn's reply; nothing else in it is kept or sent.
 */
export function linesForPerhr(reply) {
  const out = {};
  if (typeof reply !== "string" || !reply) return out;
  const clean = (v) => v.replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
  for (const line of reply.split(/\r?\n/)) {
    const m = line.match(/^[\s>*_`-]*per\.hr (note|start)[*_`]*:[*_`]*\s*(.+)$/i);
    if (!m) continue;
    const v = clean(m[2]);
    if (!v) continue;
    // The last note in the reply wins; the first Plan item asked for
    if (m[1].toLowerCase() === "note") out.note = v.slice(0, 2000);
    else out.start ??= v.slice(0, 200);
  }
  return out;
}

/** A session command (start, note) for the session this event came from, as perhr start and perhr note send it */
async function command(key, body, action, value) {
  try {
    await fetch(`${server()}/api/agent/cli`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": `perhr-codex/${HOOK_VERSION}` },
      body: JSON.stringify({ action, ...(action === "start" ? { ref: value } : { summary: value }), sessionId: body.event.session_id, tool: "codex", remote: body.remote, folder: body.folder }),
      signal: AbortSignal.timeout(6000),
    });
  } catch {}
}

/** The background half: send a body that was handed over in a file (flushing what waits first) */
async function sendLater(file) {
  let body;
  try {
    body = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return;
  } finally {
    rmSync(file, { force: true });
  }
  const key = keyOf();
  if (!key) return;
  // The lines Codex wrote for per.hr travel beside the event, never in it
  const after = body.after ?? null;
  delete body.after;
  const beat = body.event?.hook_event_name === "PostToolUse";
  if (beat) return void (await post(key, body, 4000));
  if (!(await flush(key))) return queue(body);
  const r = await post(key, body, 6000);
  if (retry(r.status)) return queue(body);
  // per.hr has the turn's end: now start the Plan item asked for, then save the note. A note that
  // can't go now isn't kept: the next turn's note covers the whole session again.
  if (after?.start) await command(key, body, "start", after.start);
  if (after?.note) await command(key, body, "note", after.note);
}

/**
 * Once a day at a session's start, the installed perhr checks for a newer release in the background
 * (perhr update --background, from the PATH). This copy of the hook has no updater of its own.
 */
function dailyCheck() {
  try {
    let s = {};
    try {
      s = JSON.parse(readFileSync(join(DIR, "update.json"), "utf8"));
    } catch {}
    if (s.checkedAt && Date.now() - new Date(s.checkedAt).getTime() < 24 * 3600_000) return;
    spawn("perhr", ["update", "--background"], { detached: true, stdio: "ignore", windowsHide: true, shell: process.platform === "win32" })
      .on("error", () => {})
      .unref();
  } catch {}
}

function inBackground(body) {
  const dir = join(DIR, "codex", "outbox");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${Date.now()}-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(body), { mode: 0o600 });
  try {
    // The same script this run came from (the copy in ~/.perhr/codex, or perhr hook codex), told to send
    spawn(process.execPath, [...process.argv.slice(1), "--send", file], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // Couldn't start the background copy: it goes out with the next event that gets through. The
    // lines Codex wrote for per.hr aren't queued with it: they travel beside an event, never in it
    const { after, ...event } = body;
    queue(event);
    rmSync(file, { force: true });
  }
}

const out = (s) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);

async function main() {
  const send = process.argv.indexOf("--send");
  if (send > 0) return sendLater(process.argv[send + 1]);
  let t = "";
  for await (const c of process.stdin) t += c;
  let ev;
  try {
    ev = JSON.parse(t);
  } catch {
    return;
  }
  const name = String(ev.hook_event_name ?? "");
  const session = String(ev.session_id ?? "");
  if (!name || !session) return;
  try {
    mkdirSync(join(DIR, "codex"), { recursive: true });
    writeFileSync(HEARD, JSON.stringify({ version: HOOK_VERSION, at: new Date().toISOString() }) + "\n");
  } catch {}
  if (name === "PostModelRequest") return addUsage(session, ev);
  if (!SENT.has(name)) return;
  if (!keyOf()) return;
  if (name === "PostToolUse" && !beatDue(session)) return;

  const dir = ev.cwd || process.cwd();
  const g = gitRemote(dir);
  const top = g?.root ?? dir;
  const folderOnly = existsSync(join(DIR, "folder-only"));
  const body = {
    tool: "codex",
    plugin: HOOK_VERSION,
    command: false,
    remote: folderOnly ? "" : (g?.remote ?? ""),
    folder: top.split(/[\\/]/).filter(Boolean).pop() ?? "",
    branch: g ? gitBranch(top) : "",
    at: new Date().toISOString(),
    event: { session_id: session, hook_event_name: name, agent_id: String(ev.agent_id ?? "") },
  };
  if (CARRY.has(name)) {
    const usage = takeUsage(session);
    if (usage) body.usage = usage;
  }
  // The main agent's turn ended: the lines it wrote for per.hr, if any (a subagent's reply is its own)
  if (name === "Stop" && !ev.agent_id) {
    const lines = linesForPerhr(ev.last_assistant_message);
    if (lines.note || lines.start) body.after = lines;
  }
  // For the perhr command (perhr start, end, note): this folder's current session, and that it's Codex's
  if (name !== "PostToolUse") {
    try {
      const was = repoState(top) ?? {};
      if (was.session !== session || was.tool !== "codex" || was.folderOnly !== folderOnly) writeJsonAtomic(stateFile(top), { session, tool: "codex", folderOnly, at: body.at });
    } catch {}
  }
  if (name !== "SessionStart") return inBackground(body);
  dailyCheck();

  // The session's start: the only call Codex waits for, so per.hr can say once if it isn't recording here
  const key = keyOf();
  const clear = await flush(key);
  const r = clear ? await post(key, body, 5000) : { status: 0, text: "" };
  if (!clear || retry(r.status)) {
    queue(body);
    return out("per.hr can't be reached right now, so this session's events are being saved on this computer and will be sent when it's back. Tell the person this once, then carry on with their task.");
  }
  // per.hr's notes for Claude Code ask the agent to run perhr note. Codex's sandbox keeps it off the
  // network, so those are left out; anything else (not recording here, setup first) is passed on.
  if (r.text && !r.text.includes("{{PERHR}}")) out(r.text);
}

export function run() {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
