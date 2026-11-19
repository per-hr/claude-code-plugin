import { hostname, platform } from "node:os";
import { readFileSync } from "node:fs";
import { apiBase, loadConfig, loadKey } from "./config.js";
import { gitRemote } from "./git.js";

/** The repo folder a command runs for: --repo, else this folder's git root */
let repoTop;
export const setRepo = (dir) => (repoTop = gitRemote(dir)?.root ?? dir);
export const currentTop = () => (repoTop === undefined ? (repoTop = gitRemote()?.root ?? null) : repoTop);

export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** An error from per.hr: code, message, and the command that fixes it */
export class ApiError extends Error {
  constructor(status, code, message, fix) {
    super(message);
    this.status = status;
    this.code = code;
    this.fix = fix;
  }
}

/** Exit codes: 0 ok, 1 error, 2 usage, 3 sign in, 4 waiting on someone (approval, setup), 5 not found */
export function exitCodeOf(e) {
  if (!(e instanceof ApiError)) return 1;
  if (e.status === 401) return 3;
  if (["setup_unfinished", "ai_queued", "ai_not_requested", "provisional", "not_available"].includes(e.code)) return 4;
  if (e.status === 404) return 5;
  return 1;
}

// This computer's time zone, so "today" on per.hr is the person's day
const ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
})();

const headers = (extra = {}) => ({
  "Content-Type": "application/json",
  ...(ZONE ? { "X-Perhr-Timezone": ZONE } : {}),
  "User-Agent": `perhr-cli/${VERSION} (${platform()})`,
  "X-Perhr-Client": `perhr-cli/${VERSION}`,
  ...extra,
});

async function parse(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (res.ok) return body;
  const err = body?.error;
  if (err && typeof err === "object") throw new ApiError(res.status, err.code, err.message, err.fix);
  throw new ApiError(res.status, res.status === 401 ? "unauthorized" : "error", typeof err === "string" ? err : body?.message || `per.hr answered ${res.status}`);
}

/**
 * Call /api/v1. `interactive` marks a request typed at a keyboard (rates are only accepted that way;
 * Claude Code gives the commands it runs no keyboard).
 */
export async function call(method, path, body, { interactive = false, workspace } = {}) {
  const k = loadKey(currentTop());
  if (!k) throw new ApiError(401, "unauthorized", "This computer isn't signed in to per.hr.", "perhr login");
  const ws = workspace ?? loadConfig().workspace ?? null;
  let res;
  try {
    res = await fetch(`${apiBase()}/api/v1/${path}`, {
      method,
      headers: headers({ Authorization: `Bearer ${k.key}`, ...(ws ? { "X-Perhr-Workspace": ws } : {}), ...(interactive ? { "X-Perhr-Interactive": "1" } : {}) }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    throw new ApiError(0, "offline", `Couldn't reach per.hr (${e.cause?.code ?? e.message}).`, "Check your connection and try again");
  }
  return parse(res);
}

/** Device sign-in: no key yet */
export async function publicCall(path, body) {
  let res;
  try {
    res = await fetch(`${apiBase()}/api/v1/${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(0, "offline", `Couldn't reach per.hr (${e.cause?.code ?? e.message}).`);
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}

/** The plugin's session commands (start, pause, resume, end, done, note, status): plain text back */
export async function sessionCall(body) {
  const k = loadKey(currentTop());
  if (!k) throw new ApiError(401, "unauthorized", "This computer isn't signed in to per.hr.", "perhr login");
  const res = await fetch(`${apiBase()}/api/agent/cli`, { method: "POST", headers: headers({ Authorization: `Bearer ${k.key}` }), body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, res.status === 401 ? "unauthorized" : "error", text.trim());
  return text.trim();
}

export const computer = () => ({ deviceName: hostname().slice(0, 80), platform: platform(), clientVersion: VERSION });
