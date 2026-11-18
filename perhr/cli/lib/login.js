import { computer, publicCall, ApiError } from "./api.js";
import { saveKey } from "./config.js";
import { bold, cyan, dim, green, openBrowser, out } from "./ui.js";

// `perhr login`: device sign-in, the way `gh auth login` works. per.hr shows the computer's name and
// where the request came from, and asks you to approve only a code you started yourself.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function login({ open = true, json = false } = {}) {
  const start = await publicCall("device/code", computer());
  if (start.status !== 200 || !start.data?.user_code) throw new ApiError(start.status, start.data?.error ?? "error", start.data?.message ?? "Couldn't start sign-in.");
  const d = start.data;
  if (json) process.stderr.write(JSON.stringify({ user_code: d.user_code, verification_uri: d.verification_uri, verification_uri_complete: d.verification_uri_complete, expires_in: d.expires_in }) + "\n");
  else {
    out("");
    out(`Your code: ${bold(d.user_code)}`);
    out(`Approve it at ${cyan(d.verification_uri_complete)}`);
    out(dim("Only approve a code you started yourself in your own terminal. per.hr never asks for this code by email, chat or phone."));
    out("");
  }
  if (open) openBrowser(d.verification_uri_complete);
  let interval = (d.interval ?? 5) * 1000;
  const until = Date.now() + (d.expires_in ?? 600) * 1000;
  if (!json) process.stdout.write(dim("Waiting for approval…"));
  while (Date.now() < until) {
    await sleep(interval);
    const r = await publicCall("device/token", { device_code: d.device_code });
    if (r.status === 200 && r.data?.key) {
      saveKey(r.data.key, r.data.user?.email ?? null);
      if (!json) out(`\r${green("Signed in")} as ${r.data.user?.email ?? "you"}.          `);
      return r.data.user;
    }
    const code = r.data?.error;
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      interval += 5000;
      continue;
    }
    if (!json) out("");
    throw new ApiError(r.status, code ?? "error", r.data?.message ?? "Sign-in didn't finish.", "perhr login");
  }
  if (!json) out("");
  throw new ApiError(400, "expired_token", "The code expired before it was approved.", "perhr login");
}
