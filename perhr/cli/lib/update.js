import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "./api.js";
import { DIR, loadConfig, saveConfig, writeJsonAtomic } from "./config.js";
import { bold, dim, err, fromNpx, green, out, tty, yellow } from "./ui.js";

// Keeping per.hr up to date on this computer. Once a day a background copy of perhr asks npm for the
// newest release. With updates on (config.json autoUpdate: true, asked in perhr setup), a newer release
// in the same major version is installed with npm, then the new perhr brings along what this computer
// has: the Claude Code plugin and the Codex hook copy. Only releases npm says were built with
// provenance (per.hr's GitHub release workflow) are installed. A new major version always waits for
// the person. With updates off or never chosen, perhr only says once a day that a release is out.

const STATE = join(DIR, "update.json");
const LOCK = join(DIR, "update.lock");
const DAY = 24 * 3600_000;
const REGISTRY = process.env.PERHR_REGISTRY || "https://registry.npmjs.org/perhr";
const BIN = fileURLToPath(new URL("../bin/perhr.js", import.meta.url));
const shell = process.platform === "win32";

const readState = () => {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
};
const saveState = (patch) => {
  const next = { ...readState(), ...patch };
  try {
    writeJsonAtomic(STATE, next, 0o644);
  } catch {}
  return next;
};

/** true, false, or null when the person hasn't chosen yet */
export const autoUpdate = () => {
  const v = loadConfig().autoUpdate;
  return v === true || v === false ? v : null;
};

const parts = (v) => String(v ?? "").split("-")[0].split(".").map((n) => Number(n) || 0);
/** 1 when a is newer than b, -1 when older, 0 when the same (prereleases count as their release) */
export function compare(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  return 0;
}
export const sameMajor = (a, b) => parts(a)[0] === parts(b)[0];

/** Built with provenance: npm records a SLSA provenance statement for the version */
export const signed = (info) => /^https:\/\/slsa\.dev\/provenance\//.test(info?.dist?.attestations?.provenance?.predicateType ?? "");

/** What per.hr has on this computer besides the command: the Claude Code plugin, the Codex hook copy */
export function partsHere() {
  let claude = false;
  try {
    claude = /\bperhr@perhr\b/.test(execFileSync("claude", ["plugin", "list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell, timeout: 15_000 }));
  } catch {}
  return { claude, codex: existsSync(join(DIR, "codex", "hook.mjs")) };
}

/** The question in perhr setup, asked once. What it lists is what this computer has. */
export async function askAutoUpdate(f, confirm) {
  if (autoUpdate() !== null || fromNpx) return;
  // Chosen with a flag (how /perhr:setup passes the answer it asked for in the chat)
  if (f["auto-update"] || f["no-auto-update"]) {
    saveConfig({ autoUpdate: !!f["auto-update"] });
    if (!f.json) out(f["auto-update"] ? green("Updates are on.") : dim("Updates are off. perhr update --on turns them on."));
    return;
  }
  // Without a terminal and without a flag, nobody was asked: leave it unchosen
  if (!tty()) return;
  const here = partsHere();
  const what = ["the perhr command", here.claude ? "the Claude Code plugin" : null, here.codex ? "the Codex hook" : null].filter(Boolean);
  const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what[0];
  out(`\n${bold("Keep per.hr up to date on this computer?")}`);
  out(dim(`  Once a day, perhr checks for a newer release and installs it in the background: ${list}.`));
  out(dim("  Only releases built and signed by per.hr's GitHub release are installed."));
  out(dim("  Turn it off or on any time: perhr update --off / --on"));
  const on = await confirm(f, "Keep it up to date?", true);
  saveConfig({ autoUpdate: on });
  out(on ? green("Updates are on.") : dim("Updates are off. perhr says when a new release is out; perhr update installs it."));
}

/** Run before a command: once a day, start the background check. Never waits, never fails. */
export function maybeCheck() {
  try {
    if (fromNpx || process.env.PERHR_NO_UPDATE || process.env.CI) return;
    const s = readState();
    if (s.checkedAt && Date.now() - new Date(s.checkedAt).getTime() < DAY) return;
    // Mark the check as started, so a burst of commands starts one background copy
    saveState({ checkedAt: new Date().toISOString() });
    spawn(process.execPath, [BIN, "update", "--background"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
}

function locked() {
  try {
    if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs < 15 * 60_000) return true;
    writeFileSync(LOCK, String(process.pid));
    return false;
  } catch {
    return true;
  }
}
const unlock = () => rmSync(LOCK, { force: true });

async function latest() {
  const r = await fetch(REGISTRY, { headers: { Accept: "application/json", "User-Agent": `perhr/${VERSION}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`npm answered ${r.status}`);
  const doc = await r.json();
  const version = doc?.["dist-tags"]?.latest;
  return { version, info: doc?.versions?.[version] };
}

/** Install a release with npm, then let the new perhr bring the plugin and the Codex hook along */
function install(version, { quiet }) {
  execFileSync("npm", ["install", "-g", `perhr@${version}`], { stdio: quiet ? "ignore" : "inherit", shell, timeout: 300_000 });
  // The new perhr, from the PATH: it knows its own plugin and hook
  const r = execFileSync("perhr", ["update", "--after", VERSION, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell, timeout: 300_000 });
  try {
    return JSON.parse(r);
  } catch {
    return {};
  }
}

/** The new perhr, right after npm installed it: update the plugin and the Codex hook copy that are here */
export async function after(from) {
  const here = partsHere();
  let claude = false;
  if (here.claude) {
    try {
      const run = (args) => execFileSync("claude", args, { stdio: "ignore", shell, timeout: 120_000 });
      run(["plugin", "marketplace", "update", "perhr"]);
      run(["plugin", "update", "perhr@perhr"]);
      claude = true;
    } catch {}
  }
  let codex = false;
  if (here.codex) {
    try {
      // The same command stays in Codex's hooks.json, so Codex keeps trusting it; only the copy changes
      (await import("./codex.js")).installHook();
      codex = true;
    } catch {}
  }
  saveState({ updated: { from, to: VERSION, at: new Date().toISOString(), claude, codex, shown: false }, failed: null });
  return { from, to: VERSION, claude, codex };
}

/** The background check (and perhr update in the foreground) */
export async function check({ quiet = true, force = false } = {}) {
  if (locked()) return { busy: true };
  const now = new Date().toISOString();
  // Counted as today's check even if npm can't be reached, so a session start doesn't retry all day
  saveState({ checkedAt: now });
  try {
    const { version, info } = await latest();
    saveState({ latest: version ?? null });
    if (!version || compare(version, VERSION) <= 0) return { current: true, latest: version };
    if (!sameMajor(version, VERSION)) return { major: version };
    if (!force && autoUpdate() !== true) return { available: version };
    if (!signed(info)) {
      saveState({ failed: { version, at: now, why: "unsigned" } });
      return { failed: version, why: "unsigned" };
    }
    try {
      const done = install(version, { quiet });
      return { updated: version, ...done };
    } catch {
      saveState({ failed: { version, at: now, why: "install" } });
      return { failed: version, why: "install" };
    }
  } catch (e) {
    return { error: e.message };
  } finally {
    unlock();
  }
}

/** After a command: at most one line, on stderr, so --json output and pipes stay clean */
export function notice() {
  try {
    if (fromNpx) return;
    const s = readState();
    const now = Date.now();
    const daily = (key) => !s[key] || now - new Date(s[key]).getTime() > DAY;
    if (s.updated && !s.updated.shown && s.updated.to === VERSION) {
      saveState({ updated: { ...s.updated, shown: true } });
      return err(dim(`perhr updated to ${VERSION} (was ${s.updated.from}).${s.updated.claude ? ` Restart Claude Code to load plugin ${VERSION}.` : ""}`));
    }
    const v = s.latest;
    if (!v || compare(v, VERSION) <= 0 || !daily("noticeAt")) return;
    saveState({ noticeAt: new Date().toISOString() });
    if (!sameMajor(v, VERSION)) return err(yellow(`perhr ${v} is out. It's a bigger change, so it waits for you: see what changed at per.hr/docs/cli, then run npm install -g perhr@${parts(v)[0]}`));
    if (s.failed?.version === v && s.failed.why === "unsigned") return err(yellow(`perhr ${v} is on npm without the signature from per.hr's release, so it wasn't installed.`));
    if (s.failed?.version === v) return err(yellow(`perhr ${v} is out, and this computer can't install it on its own.\nRun: npm install -g perhr@${v}`));
    if (autoUpdate() !== true) return err(dim(`perhr ${v} is out. Install it: perhr update${autoUpdate() === null ? ". Or keep perhr up to date on its own: perhr update --on" : ""}`));
  } catch {}
}

/** perhr doctor's line */
export function doctorLine() {
  const s = readState();
  const a = autoUpdate();
  const when = s.checkedAt ? (Date.now() - new Date(s.checkedAt).getTime() < DAY ? "checked today" : `checked ${String(s.checkedAt).slice(0, 10)}`) : "not checked yet";
  const newest = s.latest ? (compare(s.latest, VERSION) > 0 ? yellow(`${s.latest} is out`) : `${VERSION} is the latest`) : null;
  const how = fromNpx ? "run through npx (install perhr to keep it up to date)" : a === true ? "automatic" : a === false ? "off (perhr update --on)" : "not chosen (perhr update --on)";
  return `  ${a === true || fromNpx ? green("✓") : yellow("○")} Updates ${[how, when, newest].filter(Boolean).join(" · ")}`;
}

/** perhr update [--on | --off] */
export async function updateCommand(p, f) {
  if (f.background) return void (await check({ quiet: true }));
  if (typeof f.after === "string") {
    const r = await after(f.after);
    if (f.json) return r;
    return void out(green(`Updated to ${VERSION}.`));
  }
  if (f.on || f.off) {
    saveConfig({ autoUpdate: !!f.on });
    if (!f.json) out(f.on ? green("Updates are on. perhr checks once a day and installs new releases in the background.") : "Updates are off. perhr says when a new release is out; perhr update installs it.");
    return { autoUpdate: !!f.on };
  }
  if (fromNpx) throw new Error("You're running perhr through npx, which fetches the version you name each time. To keep it up to date, install it: npm install -g perhr");
  if (!f.json) out("Checking for a newer perhr…");
  const r = await check({ quiet: !!f.json, force: true });
  if (f.json) return r;
  if (r.busy) out("Another update is running. Try again in a few minutes.");
  else if (r.error) out(yellow(`Couldn't reach npm: ${r.error}`));
  else if (r.current) out(green(`perhr ${VERSION} is the latest.`));
  else if (r.major) out(yellow(`perhr ${r.major} is out. It's a bigger change, so it waits for you: see what changed at per.hr/docs/cli, then run npm install -g perhr@${parts(r.major)[0]}`));
  else if (r.failed) out(yellow(r.why === "unsigned" ? `perhr ${r.failed} is on npm without the signature from per.hr's release, so it wasn't installed.` : `Couldn't install perhr ${r.failed}. Run: npm install -g perhr@${r.failed}`));
  else if (r.updated) {
    saveState({ updated: { ...readState().updated, shown: true } });
    out(green(`Updated to ${r.updated}.`) + (r.claude ? ` Restart Claude Code to load plugin ${r.updated}.` : ""));
  }
  return r;
}

