import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The per.hr rules in Claude Code's user settings (~/.claude/settings.json), added by setup with
// your consent. Reads run without asking; changes always show Claude Code's own "Claude wants to
// run…" prompt with the full command. Sends and money are approved in the browser on per.hr, so no
// rule here can skip that. Everything already in the file stays as it was.

export const SETTINGS = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, "settings.json") : join(homedir(), ".claude", "settings.json");

export const ALLOW = [
  "Bash(perhr whoami)",
  "Bash(perhr whoami *)",
  "Bash(perhr status)",
  "Bash(perhr status *)",
  "Bash(perhr doctor)",
  "Bash(perhr doctor *)",
  "Bash(perhr setup status)",
  "Bash(perhr setup status *)",
  "Bash(perhr keys)",
  "Bash(perhr keys --json)",
  "Bash(perhr workspace)",
  "Bash(perhr workspace --json)",
  "Bash(perhr client list *)",
  "Bash(perhr client list)",
  "Bash(perhr client show *)",
  "Bash(perhr project list)",
  "Bash(perhr project list *)",
  "Bash(perhr repo list)",
  "Bash(perhr repo list *)",
  "Bash(perhr time list)",
  "Bash(perhr time list *)",
  "Bash(perhr plan list)",
  "Bash(perhr plan list *)",
  "Bash(perhr review)",
  "Bash(perhr review --json)",
  "Bash(perhr invoice list)",
  "Bash(perhr invoice list *)",
  "Bash(perhr invoice preview *)",
  "Bash(perhr estimate list)",
  "Bash(perhr estimate list *)",
  "Bash(perhr estimate preview *)",
  "Bash(perhr team)",
  "Bash(perhr team list)",
  "Bash(perhr team list *)",
  "Bash(perhr timesheets)",
  "Bash(perhr timesheets list *)",
  "Bash(perhr timesheets --week *)",
  "Bash(perhr pay)",
  "Bash(perhr pay list *)",
];

export const ASK = [
  "Bash(perhr setup --step *)",
  "Bash(perhr client add *)",
  "Bash(perhr client edit *)",
  "Bash(perhr client archive *)",
  "Bash(perhr client emails *)",
  "Bash(perhr project add *)",
  "Bash(perhr repo link *)",
  "Bash(perhr repo link)",
  "Bash(perhr time log *)",
  "Bash(perhr plan add *)",
  "Bash(perhr review confirm *)",
  "Bash(perhr review dismiss *)",
  "Bash(perhr review undo *)",
  "Bash(perhr invoice new *)",
  "Bash(perhr invoice mark-sent *)",
  "Bash(perhr invoice mark-paid *)",
  "Bash(perhr invoice mark-unpaid *)",
  "Bash(perhr invoice send *)",
  "Bash(perhr invoice remind *)",
  "Bash(perhr estimate send *)",
  "Bash(perhr keys disconnect *)",
  "Bash(perhr workspace use *)",
  "Bash(perhr logout)",
  "Bash(perhr uninstall)",
  "Bash(perhr uninstall *)",
  "Bash(perhr team invite *)",
  "Bash(perhr team cancel *)",
  "Bash(perhr team role *)",
  "Bash(perhr team hours *)",
  "Bash(perhr team remove *)",
  "Bash(perhr timesheets approve *)",
  "Bash(perhr timesheets send-back *)",
  "Bash(perhr timesheets reopen *)",
  "Bash(perhr timesheets submit *)",
  "Bash(perhr timesheets submit)",
  "Bash(perhr timesheets withdraw *)",
  "Bash(perhr pay file *)",
  "Bash(perhr pay file)",
];

export const STATUS_LINE = { type: "command", command: "perhr statusline", padding: 0 };

export function readSettings() {
  if (!existsSync(SETTINGS)) return {};
  const text = readFileSync(SETTINGS, "utf8");
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${SETTINGS} isn't valid JSON, so setup left it alone. Fix it, then run perhr setup --step claude again.`);
  }
}

/** What setup would add: the rules not there yet, and the status line if the slot is free */
export function plan(settings = readSettings()) {
  const perms = settings.permissions ?? {};
  const allow = ALLOW.filter((r) => !(perms.allow ?? []).includes(r));
  const ask = ASK.filter((r) => !(perms.ask ?? []).includes(r));
  const statusLine = settings.statusLine ? (String(settings.statusLine.command ?? "").includes("perhr statusline") ? "ours" : "taken") : "free";
  return { allow, ask, statusLine };
}

export function apply(p, { statusLine = true } = {}) {
  const settings = readSettings();
  const next = { ...settings, permissions: { ...(settings.permissions ?? {}) } };
  next.permissions.allow = [...(settings.permissions?.allow ?? []), ...p.allow];
  next.permissions.ask = [...(settings.permissions?.ask ?? []), ...p.ask];
  if (statusLine && p.statusLine === "free") next.statusLine = STATUS_LINE;
  mkdirSync(join(SETTINGS, ".."), { recursive: true });
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.perhr-backup`);
  writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + "\n");
  return { backup: existsSync(`${SETTINGS}.perhr-backup`) ? `${SETTINGS}.perhr-backup` : null };
}

// Compute: Claude Code's own telemetry (cost, tokens, models, commits, pull requests), sent to per.hr
// with this computer's key. per.hr keeps it only for sessions the plugin started.
const computeEnv = (api, key) => ({
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_LOGS_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
  OTEL_EXPORTER_OTLP_ENDPOINT: `${api}/api/agent/otel`,
  OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${key}`,
  OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "delta",
});

/**
 * Where compute stands in the settings file: "current" (per.hr, with this key), "older" (per.hr, with
 * another key, such as one made in Configure → Data), "elsewhere" (telemetry already goes to another
 * service, so setup leaves it alone) or "none"
 */
export function computeState(api, key, settings = readSettings()) {
  const env = settings.env ?? {};
  const endpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "");
  if (!endpoint) return "none";
  if (!endpoint.startsWith(api)) return "elsewhere";
  return String(env.OTEL_EXPORTER_OTLP_HEADERS ?? "").includes(key) ? "current" : "older";
}

/** Add or move compute to this computer's key, keeping everything else in the file */
export function applyCompute(api, key) {
  const settings = readSettings();
  const next = { ...settings, env: { ...(settings.env ?? {}), ...computeEnv(api, key) } };
  mkdirSync(join(SETTINGS, ".."), { recursive: true });
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.perhr-backup`);
  writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Take per.hr back out of the settings file (perhr uninstall): its rules, its status line, and compute
 * when it goes to per.hr. Everything else stays, and the previous file is saved beside it.
 */
export function removeOurs(api) {
  if (!existsSync(SETTINGS)) return { rules: 0, statusLine: false, compute: false };
  const settings = readSettings();
  const next = { ...settings };
  let rules = 0;
  if (settings.permissions) {
    next.permissions = { ...settings.permissions };
    for (const [list, ours] of [["allow", ALLOW], ["ask", ASK]]) {
      const had = settings.permissions[list];
      if (!Array.isArray(had)) continue;
      next.permissions[list] = had.filter((r) => !ours.includes(r));
      rules += had.length - next.permissions[list].length;
    }
  }
  const statusLine = String(settings.statusLine?.command ?? "").includes("perhr statusline");
  if (statusLine) delete next.statusLine;
  const compute = String(settings.env?.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").startsWith(api);
  if (compute) {
    next.env = { ...settings.env };
    for (const k of Object.keys(computeEnv(api, ""))) delete next.env[k];
  }
  if (rules || statusLine || compute) {
    copyFileSync(SETTINGS, `${SETTINGS}.perhr-backup`);
    writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  }
  return { rules, statusLine, compute };
}

/** For a status line that's already taken: what to add to the script that's there */
export const SNIPPET = `# per.hr: add this to your status line script, and print its output where you'd like it
perhr statusline < /dev/null`;
