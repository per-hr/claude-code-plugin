import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIR } from "./config.js";
import { HEARD, HOOK_VERSION } from "./codex-hook.js";

// Codex on this computer: per.hr's hook copied to ~/.perhr/codex, and Codex's hooks.json pointing at
// it. Only per.hr's own entries are ever added or removed; everything else in the file stays.

export const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
export const HOOKS = join(CODEX_HOME, "hooks.json");
const HOOK_DIR = join(DIR, "codex");
export const ENTRY = join(HOOK_DIR, "hook.mjs");
export const EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PostModelRequest", "SubagentStart", "SubagentStop", "Stop", "SessionEnd"];
/** What Codex calls each of per.hr's hooks on its review screen (without it, "Unnamed hook") */
export const HOOK_NAME = "per.hr session recording";
/** The command Codex runs. It never changes between versions, so Codex's trust in it carries over. */
export const COMMAND = `node "${ENTRY.replace(/\\/g, "/")}"`;
const LIB = ["codex-hook.js", "config.js", "git.js"];
const here = dirname(fileURLToPath(import.meta.url));

const readHooks = () => {
  try {
    return JSON.parse(readFileSync(HOOKS, "utf8"));
  } catch {
    return null;
  }
};
const ours = (h) => h && typeof h === "object" && h.command === COMMAND;

/** Whether Codex is installed here, whether per.hr's entries are in its hooks.json, and whether Codex has run them */
export function codexHere() {
  const file = readHooks();
  const events = EVENTS.filter((e) => (file?.hooks?.[e] ?? []).some((g) => (g?.hooks ?? []).some(ours)));
  let heard = null;
  try {
    heard = JSON.parse(readFileSync(HEARD, "utf8"));
  } catch {}
  // Set up by perhr 0.6.0, which asked Codex for 10 seconds on SessionEnd (Codex allows 3)
  const stale = (file?.hooks?.SessionEnd ?? []).some((g) => (g?.hooks ?? []).some((h) => ours(h) && h.timeout !== 3));
  // Set up before perhr 0.7.2, which didn't name its hooks
  const unnamed = EVENTS.some((e) => (file?.hooks?.[e] ?? []).some((g) => (g?.hooks ?? []).some((h) => ours(h) && h.statusMessage !== HOOK_NAME)));
  return { codex: existsSync(CODEX_HOME), installed: events.length === EVENTS.length, unnamed, partly: events.length > 0 && events.length < EVENTS.length, stale, files: existsSync(ENTRY), heard };
}

/** Copy the hook (and the two files it uses) to ~/.perhr/codex. Run again to update it; the command stays the same. */
export function installHook() {
  mkdirSync(join(HOOK_DIR, "lib"), { recursive: true });
  for (const f of LIB) copyFileSync(join(here, f), join(HOOK_DIR, "lib", f));
  writeFileSync(join(HOOK_DIR, "package.json"), JSON.stringify({ type: "module", private: true, version: HOOK_VERSION }) + "\n");
  writeFileSync(ENTRY, `// per.hr's hook for Codex, copied here by perhr setup --step codex (perhr ${HOOK_VERSION}).\nimport { run } from "./lib/codex-hook.js";\nrun();\n`);
}

/** Add per.hr's entries to hooks.json (the previous file is saved beside it). Returns the backup's name, or null. */
export function addHooks() {
  const had = existsSync(HOOKS) ? readFileSync(HOOKS, "utf8") : null;
  let file = readHooks();
  if (had !== null && file === null) throw new Error(`${HOOKS} isn't valid JSON, so setup left it alone. Fix it or move it aside, then run this step again.`);
  file = file && typeof file === "object" ? file : {};
  file.hooks = file.hooks && typeof file.hooks === "object" ? file.hooks : {};
  for (const e of EVENTS) {
    const groups = Array.isArray(file.hooks[e]) ? file.hooks[e] : [];
    // Codex allows a SessionEnd hook at most 3 seconds (it says so when a file asks for more)
    const timeout = e === "SessionEnd" ? 3 : 10;
    const at = groups.findIndex((g) => (g?.hooks ?? []).some(ours));
    if (at < 0) groups.push({ hooks: [{ type: "command", command: COMMAND, timeout, statusMessage: HOOK_NAME }] });
    else groups[at] = { ...groups[at], hooks: groups[at].hooks.map((h) => (ours(h) ? { ...h, timeout, statusMessage: HOOK_NAME } : h)) };
    file.hooks[e] = groups;
  }
  mkdirSync(CODEX_HOME, { recursive: true });
  let backup = null;
  if (had !== null) {
    backup = `${HOOKS}.perhr-backup`;
    writeFileSync(backup, had);
  }
  writeFileSync(HOOKS, JSON.stringify(file, null, 2) + "\n");
  return backup;
}

/** Take per.hr's entries out of hooks.json and remove the copied hook. Everything else stays. */
export function removeHooks() {
  const file = readHooks();
  let removed = 0;
  if (file?.hooks && typeof file.hooks === "object") {
    for (const e of Object.keys(file.hooks)) {
      if (!Array.isArray(file.hooks[e])) continue;
      const before = removed;
      const kept = [];
      for (const g of file.hooks[e]) {
        const mine = g && Array.isArray(g.hooks) ? g.hooks.filter(ours).length : 0;
        if (!mine) {
          kept.push(g);
          continue;
        }
        removed += mine;
        // A group that held only per.hr's hook goes with it; anything else in a group stays
        const rest = g.hooks.filter((h) => !ours(h));
        if (rest.length) kept.push({ ...g, hooks: rest });
      }
      // Only an event per.hr's removal emptied goes; one that was already empty stays as it was
      if (removed > before) {
        if (kept.length) file.hooks[e] = kept;
        else delete file.hooks[e];
      }
    }
    // Left alone, byte for byte, when per.hr's hooks weren't in it
    if (removed) writeFileSync(HOOKS, JSON.stringify(file, null, 2) + "\n");
  }
  rmSync(HOOK_DIR, { recursive: true, force: true });
  return removed;
}
