import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { call, currentTop, VERSION } from "./api.js";
import { apply, applyCompute, computeState, plan, SETTINGS, SNIPPET } from "./claude-settings.js";
import { apiBase, DIR, loadKey, saveConfig } from "./config.js";
import { login } from "./login.js";
import { bold, choose, chooseMany, confirm, cyan, dim, fromNpx, green, money, openBrowser, out, tty, typed, value, yellow } from "./ui.js";
import { gitRemote } from "./git.js";
import { addHooks, codexHere, COMMAND, EVENTS, HOOKS, installHook, removeHooks } from "./codex.js";
import { askAutoUpdate } from "./update.js";

// `perhr setup`: the ten steps, in a terminal with questions, or one step at a time with flags
// (`perhr setup --step business --business-name "Studio Lark" …`), which is how /perhr:setup runs
// them from Claude Code after asking in the chat. Progress is saved on the account.

const MARKETPLACE = "per-hr/claude-code-plugin";

export const STEPS =["work", "account", "business", "paid", "clients", "claude", "repos", "check", "try", "done"];

const email = (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Enter an email address.");
const rate = (v) => (Number(v) > 0 && Number(v) <= 100000 ? null : "Enter an hourly rate, like 125.");

/**
 * What this computer has, whatever the account's steps say: the plugin installed in Claude Code, and
 * per.hr's rules in its settings. per.hr marks the Claude Code step done once the account has a key,
 * and signing in makes one, so setup looks here before skipping that step.
 */
function claudeHere() {
  let plugin = false;
  try {
    plugin = /\bperhr@perhr\b/.test(execFileSync("claude", ["plugin", "list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" }));
  } catch {}
  let rules = false;
  try {
    const p = plan();
    rules = !p.allow.length && !p.ask.length;
  } catch {}
  return { plugin, rules };
}

function line(s, here) {
  // Done on the account, but this computer doesn't have the plugin yet
  const missing = s.id === "claude" && s.done && here && !here.plugin;
  const mark = !s.applies ? dim("-") : s.done && !missing ? green("✓") : yellow("○");
  return `  ${mark} ${s.applies ? s.title : dim(`${s.title} (the team's owner does this)`)}${missing ? dim("  (not on this computer yet)") : ""}`;
}

export async function setupStatus({ json }) {
  const s = await call("GET", "setup");
  const here = claudeHere();
  if (json) return { ...s, thisComputer: here };
  out(bold("per.hr setup"));
  for (const st of s.steps) out(line(st, here));
  if (s.beta) out(dim(`\nper.hr for AI: ${s.beta.approval}${s.beta.trialEndsAt ? `, trial until ${String(s.beta.trialEndsAt).slice(0, 10)}` : ""}`));
  const next = s.next ?? (here.plugin ? null : "claude");
  out(next ? `\nNext: ${cyan(typed(`perhr setup --step ${next}`))}` : `\n${green("Setup is done.")}`);
  if (!next && !here.rules) out(dim(`per.hr's rules aren't in your Claude Code settings on this computer, so Claude Code asks before every perhr command. Add them: ${cyan("perhr setup --step claude")}`));
  return s;
}

/**
 * On someone else's team: the rest of setup runs in that team, where the owner or an admin has set up
 * the business, payments and clients. Until the person is on a team, setup says how to get there.
 */
async function useTeam(f, own = false) {
  const me = await call("GET", "me");
  const teams = (me.workspaces ?? []).filter((w) => !w.personal);
  // Their own clients too: setup stays in Personal for the business, payments and clients, and each
  // code folder is linked to a project of their own or of a team
  if (own) {
    saveConfig({ workspace: null });
    if (teams.length) out(`You're on ${teams.map((t) => bold(t.name)).join(" and ")} too. Setup goes on with your own business here; when you link a code folder, you choose a project of your own or of the team's.`);
    else out(dim(`You're not on a team in per.hr yet. Setup goes on with your own business. When a team's owner invites you, accept it, then link that team's code folders with ${cyan("perhr setup --step repos")}.`));
    return;
  }
  if (!teams.length) {
    out(yellow("You're not on a team in per.hr yet."));
    out(`Ask the team's owner to invite you from their team's People page, accept the invite in your email, then run ${cyan("perhr setup")} again. Setup goes on with this computer meanwhile.`);
    return;
  }
  const names = teams.map((t) => t.name).join(", ");
  let team = teams.length === 1 ? teams[0] : null;
  if (!team && typeof f.team === "string") {
    team = teams.find((t) => t.id === f.team || t.name.toLowerCase() === f.team.toLowerCase());
    if (!team) throw new Error(`--team is one of: ${names}.`);
  }
  if (!team) {
    if (!tty()) throw new Error(`Say which team this computer is for with --team: ${names}.`);
    const id = await choose({}, "team", "Which team is this computer for?", teams.map((t) => ({ id: t.id, label: t.name, hint: t.role })));
    team = teams.find((t) => t.id === id);
  }
  saveConfig({ workspace: team.id });
  out(`Using ${bold(team.name)}. Its owner or an admin sets up the business, payments and clients; you link your code folders to its projects.`);
}

const STEP = {
  async work(f) {
    const work = await chooseMany(f, "work", "How do you work? Choose all that apply.", [
      { id: "solo", label: "On my own, for clients" },
      { id: "shop", label: "A small dev shop with a few people" },
      { id: "member", label: "On someone else's team" },
    ]);
    await call("PATCH", "setup/work", { work });
    out(green("Saved."));
    if (work.includes("member")) await useTeam(f, work.length > 1);
  },

  async account(f) {
    // A key of this computer's own: the plugin's older workspace key is replaced (it keeps working until then)
    const k = loadKey(currentTop());
    if (!k || k.from !== "login") {
      if (k) out(dim("This computer uses the key from the Claude Code plugin's settings. Sign in to give it a key of its own; your repos keep recording where they're linked."));
      await login({ open: !f["no-browser"] });
    }
    const s = await call("GET", "setup");
    if (s.beta?.approval === "none") {
      const note = await value(f, "note", "Anything per.hr should know (optional)", { required: false });
      const r = await call("POST", "access/request", { note });
      out(r.approval === "queued" ? yellow("Your request is in line. You'll get an email when it's approved.") : green("Requested. You can set up and work now while per.hr reviews it."));
    } else out(green(`Signed in. per.hr for AI: ${s.beta?.approval}.`));
  },

  async business(f, s) {
    if (!s.business) return out(dim("The team's owner or an admin sets up the business. Nothing to do here."));
    const b = s.business;
    const businessName = await value(f, "business-name", "Business name", { required: false, fallback: b.businessName ?? undefined });
    const name = b.personal ? await value(f, "name", "Your name", { fallback: b.name ?? undefined }) : null;
    // The address clients see on invoices, in fields: Address 1, Address 2, City, State, Zip, Country
    const a = b.addressFields ?? {};
    if (tty() && !a.address1 && b.address) out(dim(`Your address is saved as one block of text:\n${b.address}\nEnter it in fields below; until then, invoices print it as it is.`));
    const country = (await value(f, "country", "Country (two letters, like US, CA, GB, CR)", { fallback: a.country ?? undefined, check: (v) => (/^[A-Za-z]{2}$/.test(v) ? null : "Two letters, like US.") })).toUpperCase();
    const address1 = await value(f, "address1", "Address 1", { fallback: a.address1 ?? undefined });
    const address2 = await value(f, "address2", "Address 2", { required: false, fallback: a.address2 ?? undefined });
    const city = await value(f, "city", "City", { fallback: a.city ?? undefined });
    const state = await value(f, "state", country === "US" ? "State (two letters, like NY)" : "State", { required: ["US", "CA", "AU", "MX", "BR", "IN", "CR"].includes(country), fallback: a.state ?? undefined });
    const zip = await value(f, "zip", "Zip", { required: false, fallback: a.zip ?? undefined });
    const businessEmail = await value(f, "email", "Reply email for clients", { fallback: b.businessEmail ?? undefined, check: email });
    const body = { businessName, address1, address2, city, state: country === "US" && state ? state.toUpperCase() : state, zip, country, businessEmail, ...(b.personal ? { name } : {}) };
    // The rate is typed here, at the keyboard; Claude Code can't pass one in
    let defaultRate = null;
    if (tty()) defaultRate = Number(await value(f, "rate", "Default hourly rate (USD)", { fallback: b.defaultRate ?? undefined, check: rate }));
    else if (f.rate) throw new Error("Rates are typed at the keyboard. Run perhr setup --step business yourself in a terminal to set the rate.");
    await call("PATCH", b.personal ? "profile" : "workspace", { ...body, ...(defaultRate ? { defaultRate } : {}) }, { interactive: !!defaultRate });
    out(green("Saved."));
    if (!defaultRate && !b.defaultRate) out(yellow(`Set your rate yourself in a terminal: ${cyan("perhr setup --step business")}`));
  },

  async paid(f, s) {
    if (!s.paid) return out(dim("The team's owner sets up how clients pay. Nothing to do here."));
    const p = s.paid;
    if (p.stripe || p.paypal) out(green(`Connected: ${[p.stripe && "Stripe", p.paypal && "PayPal"].filter(Boolean).join(" and ")}.`));
    // Both can be on at once: clients pay by card through Stripe, or by the instructions printed on the invoice
    const stripe = !!f.stripe;
    const written = !!(f.zelle || f.venmo || f.other || f.paypal || f.payoneer);
    const how = stripe && written ? "both" : stripe ? "stripe" : written ? "instructions" : await choose(f, "how", "How do clients pay you?", [
      { id: "stripe", label: "Cards and bank transfers through Stripe", hint: "Stripe can take a few days to verify; instructions work meanwhile" },
      { id: "instructions", label: "Payment instructions on the invoice", hint: "Zelle, Venmo, PayPal, Payoneer, or anything else" },
      { id: "both", label: "Both", hint: "clients choose; the instructions also cover invoices while Stripe verifies" },
      ...(p.stripe || p.paypal ? [{ id: "keep", label: "Keep what's connected" }] : []),
    ]);
    if (how === "keep") return;
    // The instructions first (asked here), then Stripe, which finishes in the browser
    if (how === "instructions" || how === "both") {
      out(dim("These go to clients only in the PDF attached to each invoice email. A public invoice link shows your name and the pay buttons, never these."));
      const fields = {
        paymentZelle: await value(f, "zelle", "Zelle (email or phone)", { required: false, fallback: p.zelle ?? undefined }),
        paymentVenmo: await value(f, "venmo", "Venmo (@username)", { required: false, fallback: p.venmo ?? undefined }),
        paymentPaypal: await value(f, "paypal", "PayPal (email or paypal.me link)", { required: false, fallback: p.paypalContact ?? undefined }),
        paymentPayoneer: await value(f, "payoneer", "Payoneer (a payment link, or account details)", { required: false, fallback: p.payoneer ?? undefined }),
        paymentOther: await value(f, "other", "Other instructions (bank, check)", { required: false, fallback: p.other ?? undefined }),
      };
      if (!Object.values(fields).some(Boolean)) throw new Error("Add at least one way to pay.");
      await call("PATCH", s.business?.personal ? "profile" : "workspace", fields);
      out(green(how === "both" ? "Saved the instructions." : "Saved."));
    }
    if (how === "stripe" || how === "both") {
      const r = await call("POST", "payouts/stripe", { returnTo: "/setup/claude-code" });
      if (r.connected) return out(green("Stripe is connected."));
      out(`Finish connecting on Stripe: ${cyan(r.url)}`);
      openBrowser(r.url);
    }
  },

  async clients(f, s) {
    if (!s.business) return out(dim("The team's owner or an admin adds clients. Nothing to do here."));
    for (const c of s.setupClients ?? []) out(`  ${c.name} ${dim(c.email ?? "no email")} ${c.verified ? green("confirmed") : c.sentAt ? yellow("waiting") : dim("not sent")}  ${dim(c.projects.map((p) => p.name).join(", "))}`);
    if ((s.setupClients ?? []).some((c) => c.email && c.projects.length) && !f.name && !(await confirm(f, "Add another client?", false))) return;
    const name = await value(f, "name", "Client name");
    const clientEmail = await value(f, "email", "Their invoice email", { check: email });
    let c;
    try {
      c = await call("POST", "clients", { name, email: clientEmail, allowDuplicate: !!f["allow-duplicate"] });
    } catch (e) {
      if (e.status === 409) throw new Error(`${e.message} Use --allow-duplicate to add another one with the same name.`);
      throw e;
    }
    const basis = await choose(f, "basis", "How is AI work billed for this client?", [
      { id: "time", label: "Hours Worked", hint: "your time, prompting and reviewing" },
      { id: "delivered", label: "Agreed Hours", hint: "the hours agreed for each Plan item" },
    ]);
    await call("PATCH", `clients/${c.id}/ai`, { basis, private: f["show-ai"] ? false : true });
    const project = await value(f, "project", "Project name", { fallback: name });
    let projectRate = null;
    if (tty()) projectRate = await value(f, "project-rate", "Hourly rate for this project (Enter for your default)", { required: false, check: rate });
    await call("POST", "projects", { name: project, customerId: c.id, ...(projectRate ? { hourlyRate: Number(projectRate) } : {}) }, { interactive: !!projectRate });
    out(green(`Added ${name}, with ${project}.`));
    out(dim(`${name} confirms their address before invoices email them. Until then you can download the PDF and send it yourself.`));
    if (await confirm(f, `Send ${clientEmail} the confirmation email now?`, !!f.send)) {
      await call("POST", `clients/${c.id}/confirmation`, {});
      out(green("Sent."));
    }
  },

  async claude(f) {
    // 1. The plugin
    out("Installing the per.hr plugin for Claude Code…");
    const shell = process.platform === "win32";
    const claude = (args, quiet = !!f.json) => execFileSync("claude", args, { stdio: quiet ? "ignore" : "inherit", shell });
    try {
      claude(["--version"], true);
    } catch {
      throw new Error("Couldn't find claude. Install Claude Code first (https://claude.com/claude-code), then run perhr setup --step claude again.");
    }
    try {
      // Adding the marketplace again is harmless; update fetches the newest plugin version
      claude(["plugin", "marketplace", "add", MARKETPLACE]);
      claude(["plugin", "marketplace", "update", "perhr"]);
      try {
        claude(["plugin", "install", "perhr@perhr", "--scope", "user", "--yes"]);
      } catch {
        // Claude Code before 2.1.229 has no --yes
        claude(["plugin", "install", "perhr@perhr", "--scope", "user"]);
      }
    } catch {
      throw new Error(`Claude Code couldn't install the plugin. Run these yourself, then perhr setup --step claude again:\n  claude plugin marketplace add ${MARKETPLACE}\n  claude plugin install perhr@perhr --scope user`);
    }
    // An older copy already installed: bring it up to this version (best effort)
    try {
      claude(["plugin", "update", "perhr@perhr"], true);
    } catch {}
    out(green("Installed."));
    // Claude Code's installer notes any plugin option left unset; the only one here is the optional key
    if (!f.json) out(dim("If Claude Code noted an option that isn't set, that's the plugin's optional per.hr key. Leave it empty; signing in gives this computer a key of its own."));
    // 2. The perhr command in every terminal (and for the status line), when this run came from npx
    if (fromNpx && (await confirm(f, `Install the perhr command for every terminal (npm install -g perhr@${VERSION})?`, true))) {
      try {
        execFileSync("npm", ["install", "-g", `perhr@${VERSION}`], { stdio: f.json ? "ignore" : "inherit", shell: process.platform === "win32" });
        out(green("Installed perhr."));
      } catch {
        out(yellow(`Couldn't install it. Run npm install -g perhr@${VERSION} yourself.`));
      }
    }
    // Updates, asked once on this computer (not when running through npx: that copy doesn't stay)
    await askAutoUpdate(f, confirm);
    // 3. The rules: reads run without asking; every change shows Claude Code's own prompt with the full command
    const p = plan();
    if (p.allow.length || p.ask.length || p.statusLine === "free") {
      out(`\nSetup adds to ${SETTINGS}:`);
      if (p.allow.length) out(`  ${p.allow.length} rules so Claude can read per.hr without asking (perhr status, client list, invoice preview…)`);
      if (p.ask.length) out(`  ${p.ask.length} rules so every change asks you first, with the full command (client add, time log, invoice new…)`);
      if (p.statusLine === "free") out("  per.hr's status line: the Plan item, today's hours and anything waiting");
      out(dim("  Sending invoices and anything with money is approved on per.hr in your browser; no rule skips that. Everything already in the file stays."));
      if (await confirm(f, "Add them?", !!f.yes)) {
        const r = apply(p, { statusLine: !f["no-status-line"] });
        out(green("Added.") + (r.backup ? dim(` The previous file is saved as ${r.backup}.`) : ""));
      } else out(dim("Skipped. Without the rules, Claude Code asks before every perhr command."));
    } else out(green("The per.hr rules are already in your Claude Code settings."));
    // 4. Compute, with this computer's own key (a key made in per.hr keeps working until it's revoked)
    const k = loadKey(currentTop());
    if (k?.from === "login" && !f["no-compute"]) {
      const state = computeState(apiBase(), k.key);
      if (state === "current") out(green("\nCompute is already recording with this computer's key."));
      else if (state === "elsewhere") out(dim("\nClaude Code's telemetry already goes to another service, so setup left compute alone. per.hr still records your time and agent time."));
      else {
        out(
          state === "older"
            ? "\nCompute (cost, tokens, models, commits) is set up with an older per.hr key. Moving it to this computer's key keeps it recording if that key is ever revoked."
            : "\nRecord compute? Claude Code sends per.hr the cost, tokens, models, commits and pull requests for sessions the plugin records; nothing from other folders is kept.",
        );
        out(dim(`  It adds seven entries under "env" in ${SETTINGS}, including this computer's key. The file is readable only by you.`));
        if (await confirm(f, state === "older" ? "Move it?" : "Record compute?", !!f.compute || !!f.yes)) {
          applyCompute(apiBase(), k.key);
          out(green("Added.") + dim(" New Claude Code sessions pick it up."));
        } else out(dim("Skipped. Add it later with perhr setup --step claude."));
      }
    }
    if (p.statusLine === "taken") out(`\nYou already have a status line. To show per.hr in it too, add this to its script:\n${dim(SNIPPET)}`);
    out(dim("\nWhat Claude sees: when Claude runs a perhr command, its output enters the conversation. Rates you type in setup never pass through Claude. Typing perhr yourself keeps the output out of it."));
  },

  async repos(f, s) {
    const here = gitRemote();
    out(dim("These are the git folders on this computer where you run Claude Code. per.hr never reads your code; it records which folder a session ran in."));
    const repo = f.repo ?? here?.repo;
    if (!repo) throw new Error("Run this inside a git folder, or pass --repo owner/name.");
    let projects = (s.projects ?? []).map((p) => ({ ...p, ws: undefined, repos: s.repos ?? [] }));
    // Their own clients and a team's: projects from every workspace they're in, each with where it belongs.
    // A folder linked to a team's project records to that team.
    const works = s.readiness?.works ?? [];
    if (works.includes("member") && works.length > 1) {
      const me = await call("GET", "me").catch(() => null);
      const name = (w) => (w.personal ? "Personal" : w.name);
      const hereWs = me?.workspace ?? null;
      if (hereWs) projects = projects.map((p) => ({ ...p, where: name(hereWs) }));
      for (const w of me?.workspaces ?? []) {
        if (w.id === hereWs?.id) continue;
        const o = await call("GET", "setup", undefined, { workspace: w.personal ? "" : w.id }).catch(() => null);
        for (const p of o?.projects ?? []) projects.push({ ...p, ws: w.personal ? "" : w.id, where: name(w), repos: o.repos ?? [] });
      }
    }
    if (!projects.length) {
      // On someone else's team: projects come from the team, once the owner has added this person
      if (s.readiness?.work === "member" || !s.business) {
        out(yellow("No projects to link this folder to yet."));
        out(`Your team's projects show here once you're on the team and on a project. Ask the team's owner, then run ${cyan("perhr setup --step repos")} in this folder.`);
        return "stop";
      }
      throw new Error("Add a client and project first: perhr setup --step clients");
    }
    const projectId = f.project
      ? (projects.find((p) => p.id === f.project || p.name.toLowerCase() === String(f.project).toLowerCase())?.id ?? null)
      : await choose(f, "project", `Which project is ${bold(repo)} for?`, projects.map((p) => ({ id: p.id, label: p.name, hint: [p.clientName, p.where].filter(Boolean).join(" · ") })));
    if (!projectId) throw new Error(`No project named ${f.project}.`);
    const chosen = projects.find((p) => p.id === projectId);
    const existing = (chosen?.repos ?? []).find((r) => r.repo.toLowerCase() === repo.toLowerCase());
    const at = chosen?.ws === undefined ? {} : { workspace: chosen.ws };
    if (existing) await call("PATCH", `repos/${existing.id}`, { projectId }, at);
    else await call("POST", "repos", { repo, projectId }, at);
    out(green(`Linked ${repo}${chosen?.where ? ` to ${chosen.name} (${chosen.where})` : ""}.`));
    // A project in another workspace (a team's): its clients and their privacy are that workspace's to set
    if (chosen?.ws !== undefined) return;
    const client = projects.find((p) => p.id === projectId)?.clientName;
    out(dim(`Keep AI Private is on for ${client ?? "this client"}: invoices never mention AI, agent time, compute or models. Change it with perhr client edit "${client ?? ""}" --show-ai.`));
  },

  async check() {
    const d = await call("GET", "doctor");
    for (const c of d.checks) out(`  ${c.ok ? green("✓") : yellow("○")} ${c.message}${c.ok || !c.fix ? "" : dim(`  → ${c.fix}`)}`);
    // On this computer: the plugin writes ~/.perhr/plugin.json when it starts its first Claude Code session
    const here = claudeHere();
    if (!here.plugin) out(`  ${yellow("○")} The Claude Code plugin isn't installed on this computer.${dim("  → perhr setup --step claude")}`);
    else if (!existsSync(join(DIR, "plugin.json"))) out(`  ${yellow("○")} The plugin is installed and hasn't started a session yet. Start Claude Code in a linked folder and send a message.`);
    else out(`  ${green("✓")} The Claude Code plugin has started a session on this computer.`);
    for (const l of codexLines()) out(l);
  },

  // Codex, before launch: only for accounts per.hr has turned it on for (GET me says ai.codex). Not one
  // of the listed steps, and refused like an unknown step for everyone else.
  async codex(f) {
    if (f.remove) {
      const n = removeHooks();
      out(n ? green(`Removed per.hr's hooks from ${HOOKS}.`) + dim(" Everything else in the file stays.") : dim("per.hr's hooks weren't in Codex's hooks.json."));
      return;
    }
    out("per.hr records Codex sessions with a hook: a small script Codex runs when a session starts, when you prompt, and when a turn ends.");
    out(dim("  It sends what the Claude Code plugin sends (the session, its times, the repo and branch) and Codex's token counts by model."));
    out(dim("  Never your prompts, your code, or Codex's replies."));
    const here = codexHere();
    if (!here.codex) out(yellow(`\nCodex hasn't run on this computer yet (there's no ${dirname(HOOKS)}). Setup adds the hooks anyway; Codex picks them up when you install it.`));
    installHook();
    if (here.installed && here.stale) {
      out(`\nSetup updates per.hr's SessionEnd hook in ${HOOKS}: Codex allows it 3 seconds, and it asked for 10.`);
      out(dim("  The next time you start Codex, it asks you to review that one hook again. Check it and press t."));
      if (await confirm(f, "Update it?", !!f.yes)) {
        const backup = addHooks();
        out(green("Updated.") + (backup ? dim(` The previous file is saved as ${backup}.`) : ""));
      } else out(dim("Left as it was. Codex shortens it to 3 seconds itself and notes that once at startup."));
    } else if (here.installed) {
      out(green("\nper.hr's hooks are already in Codex's hooks.json.") + dim(" The hook itself was brought up to this version."));
    } else {
      out(`\nSetup adds to ${HOOKS}:`);
      out(`  ${EVENTS.length} entries that run ${COMMAND}`);
      out(dim("  Everything already in the file stays."));
      if (!(await confirm(f, "Add them?", !!f.yes))) return void out(dim("Skipped. Add them later with perhr setup --step codex."));
      const backup = addHooks();
      out(green("Added.") + (backup ? dim(` The previous file is saved as ${backup}.`) : ""));
    }
    if (!here.heard) {
      out(`\nThe next time you start Codex, it shows ${bold("Hooks need review")}:`);
      out(`  1. Choose ${bold("Review hooks")} and check that each one runs ${COMMAND}.`);
      out(`  2. Press ${bold("t")} to trust all.`);
      out(dim("  Codex runs the hooks only after that. perhr doctor shows when per.hr has heard from them."));
    }
    out(dim("\nCodex keeps per.hr up to date as it works: per.hr asks it to end each reply with a line starting \"per.hr note:\", which becomes the session's running summary, and \"per.hr start: AUD-12\" when you ask it to work on a Plan item. The hook sends only those lines; the rest of Codex's reply stays on this computer."));
    // Updates, asked once on this computer; for someone with only Codex, this is where it's asked
    await askAutoUpdate(f, confirm);
  },

  async try() {
    out("In Claude Code, in a linked folder:");
    out(`  1. Ask for a small change.`);
    out(`  2. Run ${cyan("/perhr:end")} when it's done.`);
    out(`  3. Open ${cyan("perhr review")} to see the session.`);
  },

  async done() {
    await setupStatus({ json: false });
  },
};

/** Codex on this computer, for perhr doctor and the check step: nothing at all unless per.hr's hooks were set up here */
export function codexLines() {
  const c = codexHere();
  if (!c.installed && !c.partly && !c.files) return [];
  if (!c.installed) return [`  ${yellow("○")} per.hr's Codex hooks are missing from ${HOOKS}.${dim("  → perhr setup --step codex")}`];
  if (!c.heard) return [`  ${yellow("○")} per.hr's hooks are in Codex and haven't run yet. Start Codex, choose Review hooks, check them, and press t to trust all.`];
  return [`  ${green("✓")} Codex has run per.hr's hook (${c.heard.version}, last ${new Date(c.heard.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}).`];
}

/** Codex is turned on for this account (before launch, by per.hr) */
const codexOn = async () => !!(await call("GET", "me").catch(() => null))?.ai?.codex;

export async function setup(f) {
  if (f.step) {
    if (!STEP[f.step] || (f.step === "codex" && !(await codexOn()))) throw new Error(`Steps: ${STEPS.join(", ")}.`);
    const s = f.step === "account" ? null : await call("GET", "setup");
    await STEP[f.step](f, s);
    return f.json ? call("GET", "setup") : undefined;
  }
  // The whole thing, in order, skipping what's done
  if (!tty()) throw new Error("Run perhr setup in a terminal, or one step at a time with --step (perhr setup status shows what's left).");
  out(bold("Set up per.hr for AI") + dim("  (stop anytime; progress is saved)"));
  if (loadKey(currentTop())?.from !== "login") {
    out(`\n${bold("Your Account")}`);
    await STEP.account(f);
  }
  for (const step of STEPS) {
    const s = await call("GET", "setup");
    const st = s.steps.find((x) => x.id === step);
    // The Claude Code step also runs when this computer is missing the plugin or the rules
    const here = step === "claude" ? claudeHere() : null;
    const needed = !!here && (!here.plugin || !here.rules);
    if (!st?.applies || (st.done && step !== "check" && !needed)) continue;
    out(`\n${bold(st.title)}`);
    if ((await STEP[step](f, s)) === "stop") break;
  }
  // Codex, for accounts it's turned on for, when this computer doesn't have per.hr's hooks yet
  if ((await codexOn()) && !codexHere().installed) {
    out(`\n${bold("Codex")}`);
    if (await confirm(f, "Set up Codex on this computer too?", false)) await STEP.codex(f);
  }
}

export { money };
