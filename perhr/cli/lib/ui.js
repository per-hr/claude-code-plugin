import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { platform } from "node:os";

// Printing, questions and flags. Questions are asked only in a terminal: Claude Code runs commands
// with no keyboard, so there every answer comes from a flag (and a missing one is an error naming it).

export const tty = () => !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;
const color = !process.env.NO_COLOR && !!process.stdout.isTTY;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = paint(1);
export const dim = paint(2);
export const green = paint(32);
export const yellow = paint(33);
export const red = paint(31);
export const cyan = paint(36);

export const out = (...a) => console.log(...a);
export const err = (...a) => console.error(...a);
export const money = (n) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const hours = (n) => `${Number(n ?? 0).toFixed(2)} hrs`;

/** A plain table: rows of strings, columns padded; with no rows, the empty line (or "Nothing here.") */
export function table(head, rows, empty = "Nothing here.") {
  if (!rows.length) return out(dim(empty));
  const all = [head, ...rows].map((r) => r.map((c) => String(c ?? "")));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  out(dim(all[0].map((c, i) => c.padEnd(w[i])).join("  ")));
  for (const r of all.slice(1)) out(r.map((c, i) => (/^[$\d.,-]+( hrs)?$/.test(c) ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  "));
}

/** --flag value, --flag=value, --bool, and positionals */
export function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { flags, pos };
}

let rl = null;
const ask = async (q) => {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await rl.question(q)).trim();
};
export const closeQuestions = () => {
  rl?.close();
  rl = null;
};

export class UsageError extends Error {}

/** A value from its flag, else asked in a terminal, else an error naming the flag */
export async function value(flags, name, question, { required = true, fallback, check } = {}) {
  let v = flags[name];
  if (v === true) v = "";
  if (v === undefined && tty()) {
    for (;;) {
      v = await ask(`${question}${fallback ? dim(` (${fallback})`) : ""}: `);
      if (!v && fallback !== undefined) v = String(fallback);
      const problem = v ? check?.(v) : required ? "Required." : null;
      if (!problem) break;
      err(red(problem));
    }
  }
  if ((v === undefined || v === "") && fallback !== undefined) v = String(fallback);
  if ((v === undefined || v === "") && required) throw new UsageError(`Missing --${name}.`);
  if (v && check?.(v)) throw new UsageError(`--${name}: ${check(v)}`);
  return v === undefined || v === "" ? null : String(v);
}

/** Choose one: --flag, else a numbered list in a terminal */
export async function choose(flags, name, question, options) {
  const f = flags[name];
  if (typeof f === "string") {
    const hit = options.find((o) => o.id === f || o.label.toLowerCase() === f.toLowerCase());
    if (!hit) throw new UsageError(`--${name} is one of: ${options.map((o) => o.id).join(", ")}.`);
    return hit.id;
  }
  if (!tty()) throw new UsageError(`Missing --${name} (${options.map((o) => o.id).join(", ")}).`);
  out(question);
  options.forEach((o, i) => out(`  ${bold(i + 1)}. ${o.label}${o.hint ? dim(`  ${o.hint}`) : ""}`));
  for (;;) {
    const a = await ask("Choose a number: ");
    const n = Number(a);
    if (n >= 1 && n <= options.length) return options[n - 1].id;
    const hit = options.find((o) => o.id === a);
    if (hit) return hit.id;
  }
}

/** Yes or no: --yes, else asked in a terminal, else the default */
export async function confirm(flags, question, dflt = true) {
  if (flags.yes) return true;
  if (!tty()) return dflt;
  const a = (await ask(`${question} ${dim(dflt ? "[Y/n]" : "[y/N]")} `)).toLowerCase();
  return a ? a.startsWith("y") : dflt;
}

export function openBrowser(url) {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    execFile(cmd, args, () => {}).unref();
  } catch {}
}
