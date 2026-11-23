import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DIR, writeJsonAtomic, loadKey, repoState } from "./config.js";
import { call } from "./api.js";
import { gitRemote } from "./git.js";

// `perhr statusline`: one short line for Claude Code's status line. Claude Code runs it often, so it
// reads a cache and asks per.hr at most once a minute, never waiting more than a second and a half.
// It prints nothing when this computer isn't signed in, and never fails loudly.

const CACHE = join(DIR, "statusline.json");
const FRESH_MS = 60_000;

async function stdinJson() {
  if (process.stdin.isTTY) return null;
  let text = "";
  for await (const c of process.stdin) text += c;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const h = (n) => `${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2)}h`;

export async function statusline() {
  const input = await stdinJson().catch(() => null);
  const dir = input?.workspace?.current_dir ?? input?.cwd ?? process.cwd();
  const top = gitRemote(dir)?.root ?? null;
  if (!loadKey(top)) return;
  let cache = null;
  try {
    cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : null;
  } catch {}
  if (!cache || Date.now() - cache.at > FRESH_MS) {
    const s = await Promise.race([call("GET", "status").catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))]);
    if (s) {
      cache = { at: Date.now(), s };
      try {
        writeJsonAtomic(CACHE, cache);
      } catch {}
    }
  }
  const s = cache?.s;
  const state = top ? repoState(top) : null;
  if (!s) return process.stdout.write(state?.session ? "per.hr ●" : "per.hr");
  const parts = [];
  if (s.session) parts.push(`${s.session.status === "paused" ? "❚❚" : "●"} ${s.session.item ?? "recording"}`);
  parts.push(`today ${h(s.today.hoursWorked)}`);
  // What's waiting, by name ("1 to review · 1 address unconfirmed"); a server from before kinds says how many
  for (const w of s.waiting) {
    const n = Number(w.count) || 1;
    const label = w.kind === "review" ? `${n} to review` : w.kind === "addresses" ? `${n} ${n === 1 ? "address" : "addresses"} unconfirmed` : w.kind === "setup" ? "setup unfinished" : w.kind === "approval" ? "AI approval pending" : null;
    if (!label) {
      parts.push(`${s.waiting.length} waiting`);
      break;
    }
    parts.push(label);
  }
  process.stdout.write(`per.hr ${parts.join(" · ")}`);
}
