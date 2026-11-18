import { execFileSync } from "node:child_process";
import { basename } from "node:path";

/** This folder's git remote, normalized the way per.hr stores repos ("github.com/owner/name") */
export function gitRemote(cwd = process.cwd()) {
  const run = (args) => {
    try {
      return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };
  const top = run(["rev-parse", "--show-toplevel"]);
  if (!top) return null;
  const remote = run(["remote", "get-url", "origin"]);
  return { root: top, remote: remote || null, repo: normalizeRepo(remote, top) };
}

export function normalizeRepo(remote, folder) {
  const r = (remote ?? "").trim();
  if (r) {
    const m = r.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/i);
    if (m) return `${m[1].toLowerCase()}/${m[2].replace(/^\/+/, "")}`.slice(0, 200);
  }
  return (basename((folder ?? "").replace(/[\\/]+$/, "")) || "unknown").slice(0, 200);
}
