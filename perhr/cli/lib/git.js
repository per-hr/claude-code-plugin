import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

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

// ── A folder that holds several repos (a multi-root workspace: Claude Code started in dev\walacor) ──
// Read from each repo's .git files, without running git, so session start stays quick.

/** Where a repo's git data lives: .git as a folder, or a .git file pointing elsewhere (worktrees) */
function gitDir(root) {
  const p = join(root, ".git");
  try {
    if (statSync(p).isDirectory()) return p;
    const m = readFileSync(p, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
    if (m) return isAbsolute(m[1]) ? m[1] : join(root, m[1]);
  } catch {}
  return null;
}

/** The branch checked out ("" when detached) and the commit it points at (null if unknown) */
export function headOf(root) {
  const dir = gitDir(root);
  if (!dir) return { branch: "", sha: null };
  try {
    const head = readFileSync(join(dir, "HEAD"), "utf8").trim();
    const ref = head.match(/^ref:\s*(.+)$/)?.[1];
    if (!ref) return { branch: "", sha: /^[0-9a-f]{40}$/i.test(head) ? head : null };
    const branch = ref.replace(/^refs\/heads\//, "");
    // A worktree's branches live in the main repo: commondir says where
    let common = dir;
    try {
      common = join(dir, readFileSync(join(dir, "commondir"), "utf8").trim());
    } catch {}
    for (const d of [dir, common]) {
      try {
        const sha = readFileSync(join(d, ref), "utf8").trim();
        if (sha) return { branch, sha };
      } catch {}
    }
    try {
      const line = readFileSync(join(common, "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
      if (line) return { branch, sha: line.split(" ")[0] };
    } catch {}
    return { branch, sha: null };
  } catch {
    return { branch: "", sha: null };
  }
}

/** The origin remote's URL, from .git/config */
function originOf(root) {
  const dir = gitDir(root);
  if (!dir) return null;
  let common = dir;
  try {
    common = join(dir, readFileSync(join(dir, "commondir"), "utf8").trim());
  } catch {}
  try {
    const cfg = readFileSync(join(common, "config"), "utf8");
    const section = cfg.split(/^\s*\[/m).find((s) => /^remote\s+"origin"\s*\]/.test(s));
    return section?.match(/^\s*url\s*=\s*(.+?)\s*$/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The repos one level below a folder that isn't a repo itself: [{ root, repo }], repo as per.hr
 * names it (the remote, or the folder name). Empty for a repo, or a folder with none.
 */
export function childRepos(dir, max = 30) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const root = join(dir, e.name);
    if (!existsSync(join(root, ".git"))) continue;
    out.push({ root, repo: normalizeRepo(originOf(root), root) });
    if (out.length >= max) break;
  }
  return out;
}

const norm = (p) => resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** The repo (of childRepos) a file is in, or null */
export function repoOfFile(children, file, base) {
  if (!file) return null;
  const f = norm(isAbsolute(file) ? file : join(base ?? process.cwd(), file));
  return children.find((c) => f === norm(c.root) || f.startsWith(`${norm(c.root)}/`)) ?? null;
}

/** New commits on a repo since a commit (null when git can't say) */
export function commitsSince(root, sha) {
  if (!sha) return null;
  try {
    return Number(execFileSync("git", ["rev-list", "--count", `${sha}..HEAD`], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()) || 0;
  } catch {
    return null;
  }
}
