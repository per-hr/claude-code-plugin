import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ~/.perhr: this computer's device key (credentials.json, readable only by you), settings
// (config.json: the workspace to use), and what the Claude Code plugin keeps for each repo folder
// (state/<folder hash>.json: its current session, and the key its events used). The plugin's older
// ~/.perhr/key still works until this computer signs in.

export const DIR = process.env.PERHR_HOME || join(homedir(), ".perhr");
const CREDS = join(DIR, "credentials.json");
const CONFIG = join(DIR, "config.json");
const OLD_KEY = join(DIR, "key");

const read = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

/** The key to use: PERHR_KEY, this computer's own (perhr login), the key this repo's plugin events use, then ~/.perhr/key */
export function loadKey(top) {
  if (process.env.PERHR_KEY) return { key: process.env.PERHR_KEY.trim(), from: "PERHR_KEY" };
  const c = read(CREDS);
  if (c?.key) return { key: c.key, from: "login", email: c.email ?? null };
  const repo = top ? repoState(top) : null;
  if (repo?.key) return { key: repo.key, from: "plugin" };
  if (existsSync(OLD_KEY)) {
    const k = readFileSync(OLD_KEY, "utf8").trim();
    if (k) return { key: k, from: "plugin" };
  }
  return null;
}

export function saveKey(key, email) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(CREDS, JSON.stringify({ key, email, savedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(CREDS, 0o600);
  } catch {}
}

export function forgetKey() {
  if (existsSync(CREDS)) rmSync(CREDS);
}

export const loadConfig = () => read(CONFIG) ?? {};

export function saveConfig(patch) {
  mkdirSync(DIR, { recursive: true });
  const next = { ...loadConfig(), ...patch };
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
  writeFileSync(CONFIG, JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** A repo folder's state file: the same name the plugin's hook uses */
export const stateFile = (top) => join(DIR, "state", `${createHash("sha256").update(String(top).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()).digest("hex").slice(0, 16)}.json`);
export const repoState = (top) => read(stateFile(top));

export function writeJsonAtomic(path, value, mode = 0o600) {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value) + "\n", { mode });
  renameSync(tmp, path);
}

export const apiBase = () => (process.env.PERHR_API || loadConfig().api || "https://per.hr").replace(/\/+$/, "");

/**
 * The folder whose session a perhr command belongs to, and its state: this repo (or folder), or a
 * folder above it that Claude Code was started in (a folder of repos, with Claude since gone into one
 * of them). When both have one, the one that last had a prompt.
 */
export function sessionState(start) {
  let best = null;
  let dir = start;
  for (let i = 0; i < 6 && dir; i++) {
    const st = repoState(dir);
    if (st?.session) {
      let at = 0;
      try {
        at = statSync(stateFile(dir)).mtimeMs;
      } catch {}
      // Above the starting folder, only a folder Claude Code was started in that holds repos
      if ((i === 0 || st.children?.length) && (!best || at > best.at)) best = { dir, state: st, at };
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return best;
}
