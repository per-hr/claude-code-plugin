import { execFileSync, spawn } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, closeSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { call } from "./api.js";
import { compare } from "./update.js";
import { bold, confirm, cyan, dim, green, out, typed, yellow } from "./ui.js";

// perhr desktop: installs per.hr Desktop, the tray (Windows) or menu bar (Mac) app, on a computer
// signed in to per.hr. per.hr hands the installer's address only to a signed-in computer, and perhr
// downloads it itself: a file a browser didn't download carries no "from the internet" mark, so
// Windows SmartScreen and macOS Gatekeeper don't stop it. After that the app updates itself.

export const desktopOs = (p = process.platform) => (p === "win32" ? "windows" : p === "darwin" ? "mac" : null);

const UNINSTALL = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
const MAC_APP = "/Applications/per.hr.app";

/** From `reg query <Uninstall> /s`: the version of the entry whose DisplayName is per.hr, else null */
export function versionFromRegistry(text) {
  for (const block of String(text ?? "").split(/\r?\n(?=HKEY_)/)) {
    if (!/^\s+DisplayName\s+REG_SZ\s+per\.hr\s*$/m.test(block)) continue;
    const v = block.match(/^\s+DisplayVersion\s+REG_SZ\s+(\S+)\s*$/m);
    return v ? v[1] : "";
  }
  return null;
}

/** From an app's Info.plist: CFBundleShortVersionString, else null */
export function versionFromPlist(text) {
  const m = String(text ?? "").match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  return m ? m[1].trim() : null;
}

/** The installed version: "0.2.0", "" when it's there but the version can't be read, null when it isn't installed */
export function installedDesktop() {
  const os = desktopOs();
  if (os === "windows") {
    try {
      const v = versionFromRegistry(execFileSync("reg", ["query", UNINSTALL, "/s"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 << 20 }));
      if (v !== null) return v;
    } catch {}
    const dir = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "per.hr");
    return ["per.hr.exe", "perhr-desktop.exe"].some((f) => existsSync(join(dir, f))) ? "" : null;
  }
  if (os === "mac") {
    try {
      return versionFromPlist(readFileSync(join(MAC_APP, "Contents", "Info.plist"), "utf8")) ?? "";
    } catch {
      return existsSync(MAC_APP) ? "" : null;
    }
  }
  return null;
}

/** What to do: install, update, or nothing (current), given what's here and per.hr's newest */
export function desktopPlan(installed, latest, force = false) {
  if (installed === null) return "install";
  if (force || !installed || compare(latest, installed) > 0) return installed && compare(latest, installed) <= 0 ? "reinstall" : "update";
  return "current";
}

/** The installer's first bytes look right: a Windows program (MZ) or anything for a disk image (hdiutil checks it) */
export function looksRight(os, head) {
  return os === "mac" ? head.length > 0 : head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a;
}

export async function download(info) {
  if (!/^https:\/\//.test(info.url) || !/^[\w.@-]+\.(exe|dmg)$/.test(info.file)) throw new Error("per.hr sent an installer address perhr doesn't accept.");
  const dir = mkdtempSync(join(tmpdir(), "perhr-desktop-"));
  const file = join(dir, info.file);
  // Whatever goes wrong from here, the temp folder goes too
  try {
    let res;
    try {
      res = await fetch(info.url);
    } catch (e) {
      throw new Error(`Couldn't download per.hr Desktop (${e.cause?.code ?? e.message}).`);
    }
    if (!res.ok || !res.body) throw new Error(`Couldn't download per.hr Desktop (${res.status}).`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
    const size = statSync(file).size;
    const want = Number(res.headers.get("content-length") ?? 0);
    const head = Buffer.alloc(2);
    const fd = openSync(file, "r");
    readSync(fd, head, 0, 2, 0);
    closeSync(fd);
    if (!size || (want && size !== want) || !looksRight(desktopOs(), head)) throw new Error("The download didn't arrive whole. Run perhr desktop again.");
    return { dir, file, size };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", (code) => resolve(code ?? 1));
  });

async function installWindows(file) {
  out(dim("The per.hr installer is open. Follow it to the end; perhr waits here."));
  const code = await run(file, []);
  if (code !== 0) throw new Error(`The installer stopped before it finished (${code}). Run perhr desktop to try again.`);
}

async function installMac(dir, file) {
  const mount = join(dir, "mount");
  execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, file], { stdio: "ignore" });
  try {
    const app = readdirSync(mount).find((f) => f.endsWith(".app"));
    if (!app) throw new Error("The disk image has no app in it.");
    // Quit a running copy, then put the new one in Applications
    try {
      execFileSync("osascript", ["-e", 'tell application "per.hr" to quit'], { stdio: "ignore" });
    } catch {}
    rmSync(MAC_APP, { recursive: true, force: true });
    cpSync(join(mount, app), MAC_APP, { recursive: true, verbatimSymlinks: true });
  } finally {
    try {
      execFileSync("hdiutil", ["detach", mount, "-quiet"], { stdio: "ignore" });
    } catch {}
  }
  try {
    execFileSync("open", [MAC_APP], { stdio: "ignore" });
  } catch {}
}

/** perhr desktop [--check] [--force] [--json] */
export async function desktop(f) {
  const os = desktopOs();
  if (!os) throw new Error("per.hr Desktop is for Windows and Mac.");
  const info = await call("GET", `desktop/installer?os=${os}`);
  const installed = installedDesktop();
  const action = desktopPlan(installed, info.version, !!f.force);
  const result = { os, installed, latest: info.version, action };
  if (f.check || action === "current") {
    if (!f.json) {
      if (installed === null) out(`per.hr Desktop ${info.version} isn't installed on this computer.${dim(`  → ${typed("perhr desktop")}`)}`);
      else if (action === "current") out(`${green("✓")} per.hr Desktop ${installed} is installed and up to date. It updates itself.`);
      else out(`per.hr Desktop ${installed || "(version unknown)"} is installed; ${info.version} is out. It updates itself at its next start, or ${cyan(typed("perhr desktop"))} now.`);
    }
    return { ...result, action: f.check ? "check" : action };
  }
  if (!f.json) out(`${action === "install" ? "Installing" : "Updating"} ${bold(`per.hr Desktop ${info.version}`)}${installed ? dim(` (now ${installed || "installed"})`) : ""}…`);
  const dl = await download(info);
  try {
    if (os === "windows") await installWindows(dl.file);
    else await installMac(dl.dir, dl.file);
  } finally {
    rmSync(dl.dir, { recursive: true, force: true });
  }
  const now = installedDesktop();
  if (!f.json) {
    if (now === null) out(yellow("The installer closed before per.hr Desktop was installed. Run perhr desktop to try again."));
    else out(`${green("✓")} per.hr Desktop ${now || info.version} is installed. ${os === "mac" ? "It's in the menu bar." : "It's in the system tray; Windows may tuck it under the ^ arrow."} It updates itself from here.`);
  }
  return { ...result, installed: now };
}

/** At the end of perhr setup: offer per.hr Desktop once, when it isn't on this computer */
export async function offerDesktop(f) {
  const os = desktopOs();
  if (!os || installedDesktop() !== null) return;
  // Only when per.hr has one for this account (it needs per.hr for AI) and system
  if (!(await call("GET", `desktop/installer?os=${os}`).catch(() => null))) return;
  out(`\n${bold("per.hr Desktop")}`);
  out(`Today's time and your agents in the ${os === "mac" ? "menu bar" : "system tray"}, with a notice when an agent waits on you or a session is ready for Review. It keeps itself, perhr and the Claude Code plugin up to date.`);
  if (!(await confirm(f, "Install it?", true))) return void out(dim(`Skipped. Install it later with ${typed("perhr desktop")}.`));
  try {
    await desktop({ ...f, json: false });
  } catch (e) {
    out(yellow(`${e.message}`) + dim(`  Setup goes on; install it later with ${typed("perhr desktop")}.`));
  }
}
