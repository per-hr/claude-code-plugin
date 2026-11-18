import { call, currentTop, sessionCall, VERSION } from "./api.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIR, forgetKey, loadConfig, loadKey, repoState, saveConfig } from "./config.js";
import { login } from "./login.js";
import { setup, setupStatus } from "./setup.js";
import { gitRemote } from "./git.js";
import { bold, choose, confirm, cyan, dim, green, hours, money, openBrowser, out, table, tty, UsageError, value, yellow } from "./ui.js";

// Each command returns data (printed as JSON with --json) and prints for people otherwise.

const today = () => new Date().toISOString().slice(0, 10);
const shortDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** A client by name (or id), case-insensitive, unique prefix allowed */
async function findClient(ref) {
  if (!ref) throw new UsageError("Name the client.");
  const list = await call("GET", "clients");
  const r = String(ref).toLowerCase();
  const exact = list.filter((c) => c.id === ref || c.name.toLowerCase() === r);
  const hits = exact.length ? exact : list.filter((c) => c.name.toLowerCase().startsWith(r));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new UsageError(`No client named ${ref}. See perhr client list.`);
  throw new UsageError(`Several clients match ${ref}: ${hits.map((c) => c.name).join(", ")}.`);
}

async function findProject(ref) {
  const list = await call("GET", "projects");
  if (!ref) {
    // In a linked folder, its project
    const here = gitRemote();
    if (here) {
      const { repos } = await call("GET", "repos");
      const linked = repos.find((x) => x.repo.toLowerCase() === here.repo.toLowerCase() && x.projectId);
      if (linked) return list.find((p) => p.id === linked.projectId) ?? { id: linked.projectId, name: linked.project };
    }
    throw new UsageError("Name the project with --project (or run this in a linked folder).");
  }
  const r = String(ref).toLowerCase();
  const hits = list.filter((p) => p.id === ref || p.name.toLowerCase() === r);
  const loose = hits.length ? hits : list.filter((p) => p.name.toLowerCase().startsWith(r));
  if (loose.length === 1) return loose[0];
  if (!loose.length) throw new UsageError(`No project named ${ref}. See perhr project list.`);
  throw new UsageError(`Several projects match ${ref}: ${loose.map((p) => p.name).join(", ")}.`);
}

export const COMMANDS = {
  async login(_p, f) {
    const user = await login({ open: !f["no-browser"], json: f.json });
    return { signedIn: true, user };
  },

  async logout(_p, f) {
    const k = loadKey();
    if (k?.from === "login") {
      // Disconnect this computer on per.hr too, so its key stops working everywhere
      const me = await call("GET", "keys").catch(() => null);
      const mine = me?.keys?.find((x) => x.thisComputer);
      if (mine) await call("DELETE", `keys/${mine.id}`).catch(() => null);
    }
    forgetKey();
    if (!f.json) out("Signed out. This computer is disconnected from per.hr.");
    return { signedOut: true };
  },

  async whoami(_p, f) {
    const me = await call("GET", "me");
    if (!f.json) {
      out(`${bold(me.user?.email)}${me.user?.name ? dim(`  ${me.user.name}`) : ""}`);
      out(`Workspace: ${me.workspace?.name ?? "?"}${dim(`  (${me.workspace?.role})`)}`);
      out(`Computer: ${me.key?.computer ?? dim(me.key?.kind === "workspace" ? "a workspace key" : "?")}`);
      out(`per.hr for AI: ${me.ai.approval}${me.ai.access === "trial" && me.ai.trialEndsAt ? `, trial until ${shortDate(me.ai.trialEndsAt)}` : ""}`);
    }
    return me;
  },

  async setup(p, f) {
    if (p[0] === "status") return setupStatus({ json: f.json });
    return setup(f);
  },

  async status(p, f) {
    // In a folder Claude Code is recording: this session's Plan items, time and cost (the plugin's /perhr:status)
    const top = currentTop();
    const state = top ? repoState(top) : null;
    let sessionText = null;
    if (state?.session) sessionText = (await session("status", [], { ...f, json: true }).catch(() => null))?.reply ?? null;
    if (sessionText && !f.json) out(sessionText);
    // Everything waiting, from per.hr (while the per.hr CLI isn't on for the account, only the session part shows)
    let s = null;
    try {
      s = await call("GET", "status");
    } catch (e) {
      if (sessionText && ["not_available", "unauthorized", "key_revoked"].includes(e.code)) return { session: sessionText };
      throw e;
    }
    if (!f.json) {
      if (!sessionText) {
        if (s.session) out(`${green("●")} ${s.session.status === "paused" ? "Paused" : "Recording"}: ${s.session.item ?? s.session.repo}`);
        else out(dim("No session recording."));
      }
      out(`Today: ${hours(s.today.hoursWorked)} worked, ${hours(s.today.agentHours)} agent`);
      if (s.waiting.length) {
        out(bold("\nWaiting"));
        for (const w of s.waiting) out(`  ${w.what}${dim(`, waiting on ${w.who}`)}${w.fix ? `  ${cyan(w.fix)}` : ""}`);
      }
    }
    return { ...s, ...(sessionText ? { sessionReply: sessionText } : {}) };
  },

  async doctor(_p, f) {
    // The Claude Code plugin writes its version at each session start; the two are released together
    let plugin = null;
    try {
      plugin = JSON.parse(readFileSync(join(DIR, "plugin.json"), "utf8"));
    } catch {}
    const local = { node: process.versions.node, cli: VERSION, plugin: plugin?.version ?? null, key: loadKey()?.from ?? null };
    if (!f.json) {
      out(`  ${green("✓")} perhr ${VERSION}, Node ${local.node}`);
      if (!plugin) out(`  ${yellow("○")} The Claude Code plugin hasn't started a session on this computer yet.${dim("  → perhr setup --step claude")}`);
      else if (plugin.version !== VERSION)
        out(`  ${yellow("○")} The Claude Code plugin is ${plugin.version} and perhr is ${VERSION}; they're released together.${dim("  → npx perhr@latest setup --step claude")}`);
      else out(`  ${green("✓")} Claude Code plugin ${plugin.version}, the same as perhr`);
    }
    const d = await call("GET", "doctor");
    if (!f.json) {
      for (const c of d.checks) out(`  ${c.ok ? green("✓") : yellow("○")} ${c.message}${c.ok || !c.fix ? "" : dim(`  → ${c.fix}`)}`);
    }
    return { ...d, local };
  },

  async keys(p, f) {
    if (p[0] === "disconnect") {
      if (!p[1]) throw new UsageError("perhr keys disconnect <id> (ids are in perhr keys)");
      if (!(await confirm(f, "Disconnect it? It stops working at once.", false))) return { cancelled: true };
      const r = await call("DELETE", `keys/${p[1]}`);
      if (r.thisComputer) forgetKey();
      if (!f.json) out(r.thisComputer ? "Disconnected this computer." : "Disconnected.");
      return r;
    }
    const { keys } = await call("GET", "keys");
    if (!f.json)
      table(
        ["ID", "Computer or Key", "Workspace", "Last Used", "Where"],
        keys.map((k) => [k.id, `${k.deviceName ?? k.name}${k.thisComputer ? " (this one)" : ""}`, k.workspace ?? "", k.lastUsedAt ? shortDate(k.lastUsedAt) : "never", k.lastPlace ?? ""]),
        "No computers or keys.",
      );
    return { keys };
  },

  async workspace(p, f) {
    const me = await call("GET", "me");
    if (p[0] === "use") {
      const r = (p[1] ?? "").toLowerCase();
      const w = me.workspaces.find((x) => x.id === p[1] || x.name.toLowerCase() === r);
      if (!w) throw new UsageError(`Workspaces: ${me.workspaces.map((x) => x.name).join(", ")}.`);
      saveConfig({ workspace: w.personal ? null : w.id });
      if (!f.json) out(`Using ${w.name}. A linked repo still records to its own project's workspace.`);
      return { workspace: w };
    }
    if (!f.json) for (const w of me.workspaces) out(`${w.id === me.workspace?.id ? green("●") : " "} ${w.name} ${dim(w.role)}`);
    return { workspaces: me.workspaces, current: me.workspace };
  },

  async client(p, f) {
    const sub = p[0] ?? "list";
    if (sub === "list") {
      const list = (await call("GET", "clients")).filter((c) => f.all || !c.archivedAt);
      if (!f.json) table(["Client", "Email", "Status", "Projects", "Unbilled"], list.map((c) => [c.name, c.email ?? "", c.emailStatus, c.activeProjectCount, money(c.unbilledAmount)]), "No clients yet. Add one: perhr client add");
      return list;
    }
    if (sub === "add") {
      const name = p[1] ?? (await value(f, "name", "Client name"));
      const email = await value(f, "email", "Their invoice email", { required: false });
      if (f["dry-run"]) return { dryRun: true, would: { name, email } };
      const c = await call("POST", "clients", { name, email, allowDuplicate: !!f["allow-duplicate"] });
      if (!f.json) out(green(`Added ${c.name}.`) + (email ? dim(` ${c.name} confirms ${email} before invoices email them: perhr client emails "${c.name}" --send`) : ""));
      return c;
    }
    const c = await findClient(p[1]);
    if (sub === "show") {
      const [full, ai] = await Promise.all([call("GET", `clients/${c.id}`), call("GET", `clients/${c.id}/ai`)]);
      if (!f.json) {
        out(bold(full.name));
        if (full.email) out(`Email: ${full.email} ${dim(c.emailStatus)}`);
        out(`AI work billed by: ${ai.basis === "delivered" ? "Agreed Hours" : "Hours Worked"}. Keep AI Private: ${ai.private ? "on" : "off"}.`);
      }
      return { ...full, ai };
    }
    if (sub === "edit") {
      const ai = {};
      if (f["show-ai"]) ai.private = false;
      if (f["hide-ai"]) ai.private = true;
      if (f.basis) ai.basis = f.basis === "agreed" ? "delivered" : f.basis === "worked" ? "time" : f.basis;
      const fields = Object.fromEntries(["email", "company", "address", "phone"].filter((k) => typeof f[k] === "string").map((k) => [k, f[k]]));
      if (typeof f.rename === "string") fields.name = f.rename;
      if (!Object.keys(ai).length && !Object.keys(fields).length) throw new UsageError("Nothing to change. Flags: --rename, --email, --address, --phone, --basis worked|agreed, --show-ai, --hide-ai.");
      if (f["dry-run"]) return { dryRun: true, client: c.name, would: { ...fields, ...ai } };
      if (Object.keys(fields).length) await call("PATCH", `clients/${c.id}`, fields);
      if (Object.keys(ai).length) await call("PATCH", `clients/${c.id}/ai`, ai);
      if (!f.json) out(green("Saved."));
      return { ok: true };
    }
    if (sub === "emails") {
      if (f.send || f.resend) {
        await call("POST", `clients/${c.id}/confirmation`, {});
        if (!f.json) out(green("Sent the confirmation email."));
        return { sent: true };
      }
      const r = await call("GET", `clients/${c.id}/emails`);
      if (!f.json) table(["Address", "Status", "Invoices"], r.addresses.map((a) => [a.email, a.blocked ? "blocked" : a.confirmed ? "confirmed" : a.confirmationSentAt ? "waiting" : "not sent", a.invoices ? "yes" : ""]));
      return r;
    }
    if (sub === "archive") {
      if (!(await confirm(f, `Archive ${c.name}?`, false))) return { cancelled: true };
      await call("PATCH", `clients/${c.id}`, { archived: true });
      if (!f.json) out("Archived.");
      return { ok: true };
    }
    throw new UsageError("perhr client list | add | show | edit | emails | archive");
  },

  async project(p, f) {
    const sub = p[0] ?? "list";
    if (sub === "list") {
      const list = (await call("GET", "projects")).filter((x) => f.all || x.status !== "archived");
      if (!f.json) table(["Project", "Client", "Status"], list.map((x) => [x.name, x.customer?.name ?? "", x.status]), "No projects yet. Add one: perhr project add");
      return list;
    }
    if (sub === "add") {
      const name = p[1] ?? (await value(f, "name", "Project name"));
      const client = f.client ? await findClient(f.client) : null;
      const rate = tty() ? await value(f, "rate", "Hourly rate (Enter for your default)", { required: false }) : null;
      if (f.rate && !tty()) throw new UsageError("Rates are typed at the keyboard. Run perhr project add yourself in a terminal to set one.");
      if (f["dry-run"]) return { dryRun: true, would: { name, client: client?.name ?? null } };
      const x = await call("POST", "projects", { name, ...(client ? { customerId: client.id } : {}), ...(rate ? { hourlyRate: Number(rate) } : {}) }, { interactive: !!rate });
      if (!f.json) out(green(`Added ${x.name}.`));
      return x;
    }
    throw new UsageError("perhr project list | add");
  },

  async repo(p, f) {
    const sub = p[0] ?? "list";
    if (sub === "list") {
      const { repos } = await call("GET", "repos");
      if (!f.json) table(["Repo", "Project", "Client", "Last Seen"], repos.map((r) => [r.repo, r.ignored ? "(not recorded)" : (r.project ?? "(not linked)"), r.client ?? "", shortDate(r.lastSeenAt)]), "No repos yet. In a repo folder: perhr repo link");
      return { repos };
    }
    if (sub === "link") {
      const here = gitRemote();
      const repo = f.repo ?? here?.repo;
      if (!repo) throw new UsageError("Run this in a git folder, or pass --repo owner/name.");
      const project = await findProject(f.project ?? p[1]);
      if (f["dry-run"]) return { dryRun: true, would: { repo, project: project.name } };
      const { repos } = await call("GET", "repos");
      const had = repos.find((r) => r.repo.toLowerCase() === repo.toLowerCase());
      if (had) await call("PATCH", `repos/${had.id}`, { projectId: project.id });
      else await call("POST", "repos", { repo, projectId: project.id });
      if (!f.json) out(green(`${repo} records to ${project.name}.`));
      return { repo, project: project.name };
    }
    throw new UsageError("perhr repo list | link");
  },

  async time(p, f) {
    const sub = p[0] ?? "list";
    if (sub === "list") {
      const q = new URLSearchParams({ ...(f.from ? { startDate: f.from } : {}), ...(f.to ? { endDate: f.to } : {}), ...(f.unbilled ? { isBilled: "false" } : {}) });
      const list = await call("GET", `time?${q}`);
      if (!f.json) table(["Date", "Project", "Hours", "Title"], list.slice(0, Number(f.limit ?? 25)).map((e) => [shortDate(e.date), e.project?.name ?? "", hours(e.hours), e.title ?? ""]), "No time in that range.");
      return list;
    }
    if (sub === "log") {
      const h = Number(p[1] ?? (await value(f, "hours", "Hours")));
      if (!(h > 0)) throw new UsageError("perhr time log <hours> --project <name> [--title …] [--date YYYY-MM-DD]");
      const project = await findProject(f.project);
      const body = { projectId: project.id, date: f.date ?? today(), hours: h, ...(f.title ? { title: f.title } : {}), ...(f.note ? { description: f.note } : {}) };
      if (f["dry-run"]) return { dryRun: true, would: { ...body, project: project.name } };
      const e = await call("POST", "time", body);
      if (!f.json) out(green(`Logged ${hours(h)} on ${project.name}.`));
      return e;
    }
    throw new UsageError("perhr time list | log");
  },

  async plan(p, f) {
    const sub = p[0] ?? "list";
    if (sub === "list") {
      const project = f.project ? await findProject(f.project) : null;
      const list = await call("GET", `plan${project ? `?projectId=${project.id}` : ""}`);
      const items = Array.isArray(list) ? list : (list.items ?? []);
      if (!f.json) table(["Ref", "Title", "Status", "Estimate"], items.filter((i) => f.all || i.status !== "done").map((i) => [i.ref ?? "", i.title, i.status, i.estimatedHours ? hours(i.estimatedHours) : ""]), "No open Plan items.");
      return items;
    }
    if (sub === "add") {
      const title = p.slice(1).join(" ") || (await value(f, "title", "Title"));
      const project = await findProject(f.project);
      const body = { projectId: project.id, title, ...(f.ref ? { ref: f.ref } : {}), ...(f.estimate ? { estimatedHours: Number(f.estimate) } : {}) };
      if (f["dry-run"]) return { dryRun: true, would: { ...body, project: project.name } };
      const i = await call("POST", "plan", body);
      if (!f.json) out(green(`Added to ${project.name}'s Plan.`));
      return i;
    }
    throw new UsageError("perhr plan list | add");
  },

  async review(p, f) {
    const sub = p[0] ?? "list";
    if (sub === "list") {
      const r = await call("GET", "review");
      if (!f.json) {
        table(["ID", "When", "Project", "Hours Worked", "Agent", "What"], r.sessions.map((s) => [s.id, shortDate(s.startedAt), s.project?.name ?? "(no project)", hours(s.humanHours), hours(s.agentHours), (s.item ? `${s.item.ref ? `${s.item.ref}: ` : ""}${s.item.title}` : (s.summary ?? "").split("\n")[0]).slice(0, 60)]), "Nothing in To Review.");
      }
      return r;
    }
    const id = p[1];
    if (!id) throw new UsageError(`perhr review ${sub} <id> (ids are in perhr review)`);
    const path = { confirm: "confirm", dismiss: "dismiss", undo: "undo" }[sub];
    if (!path) throw new UsageError("perhr review | review confirm <id> | dismiss <id> | undo <id>");
    if (f["dry-run"]) return { dryRun: true, would: `${sub} ${id}` };
    const r = await call("POST", `review/${id}/${path}`, {});
    if (!f.json) out(green({ confirm: "Confirmed.", dismiss: "Dismissed.", undo: "Back in To Review." }[sub]));
    return r;
  },

  async invoice(p, f) {
    const sub = p[0] ?? "list";
    if (sub === "list") {
      const list = await call("GET", "invoices");
      const shown = list.filter((i) => !f.status || i.status === f.status);
      if (!f.json) table(["Invoice", "Client", "Status", "Issued", "Total"], shown.slice(0, Number(f.limit ?? 25)).map((i) => [i.invoiceNumber, i.customer?.name ?? "", i.status, shortDate(i.issueDate), money(i.total)]), f.status ? `No ${f.status} invoices.` : "No invoices yet.");
      return shown;
    }
    if (sub === "new") {
      const c = await findClient(p[1] ?? f.client);
      const unbilled = await call("GET", `time?customerId=${c.id}&isBilled=false`);
      if (!unbilled.length) throw new UsageError(`No unbilled time for ${c.name}.`);
      const total = unbilled.reduce((t, e) => t + e.hours * (e.hourlyRate ?? 0), 0);
      if (!f.json) out(`${unbilled.length} unbilled ${unbilled.length === 1 ? "entry" : "entries"} for ${c.name}: ${hours(unbilled.reduce((t, e) => t + e.hours, 0))}, ${money(total)}.`);
      if (f["dry-run"]) return { dryRun: true, would: { client: c.name, entries: unbilled.length, total: total.toFixed(2) } };
      const inv = await call("POST", "invoices", { customerId: c.id, issueDate: today(), entryIds: unbilled.map((e) => e.id) });
      if (!f.json) out(green(`Draft ${inv.invoiceNumber} made. Preview it: ${cyan(`perhr invoice preview ${inv.invoiceNumber}`)}`));
      return inv;
    }
    if (sub === "preview") {
      if (!p[1]) throw new UsageError("perhr invoice preview <INV-0001>");
      const r = await call("GET", `invoices/${encodeURIComponent(p[1])}/preview`);
      if (!f.json) {
        printChecks(r.invoice, r.checks, r.canSend);
        if (f.open && r.invoice.url) openBrowser(r.invoice.url);
      }
      return r;
    }
    if (sub === "mark-sent" || sub === "mark-paid" || sub === "mark-unpaid") {
      if (!p[1]) throw new UsageError(`perhr invoice ${sub} <INV-0001>`);
      const status = { "mark-sent": "sent", "mark-paid": "paid", "mark-unpaid": "sent" }[sub];
      const body = { status, ...(sub === "mark-paid" && f.via ? { paymentMethod: f.via } : {}), ...(sub === "mark-paid" && f.date ? { paidAt: f.date } : {}) };
      if (f["dry-run"]) return { dryRun: true, would: { invoice: p[1], ...body } };
      await call("PATCH", `invoices/${encodeURIComponent(p[1])}`, body);
      if (!f.json) out(green("Saved."));
      return { ok: true };
    }
    if (sub === "open") {
      if (!p[1]) throw new UsageError("perhr invoice open <INV-0001>");
      const r = await call("GET", `invoices/${encodeURIComponent(p[1])}/preview`);
      const base = loadConfig().api || "https://per.hr";
      openBrowser(`${base}/invoices/${r.invoice.id}`);
      if (!f.json) out(`Opened ${r.invoice.number} in per.hr, where you can download the PDF.`);
      return { opened: r.invoice.id };
    }
    if (sub === "remind") {
      if (!p[1]) throw new UsageError("perhr invoice remind <INV-0001> [--test]");
      return sendThings("reminder", p.slice(1), f);
    }
    if (sub === "send") {
      let refs = p.slice(1);
      if (f["all-ready"]) {
        const drafts = (await call("GET", "invoices")).filter((i) => i.status === "draft").slice(0, 25);
        refs = drafts.map((i) => i.invoiceNumber);
        if (!refs.length) throw new UsageError("No draft invoices.");
      }
      if (!refs.length) throw new UsageError("perhr invoice send <INV-0001> [more…] | --all-ready [--test]");
      return sendThings("invoice", refs, f);
    }
    throw new UsageError("perhr invoice list | new <client> | preview <INV> | open <INV> | send <INV…> | remind <INV> | mark-sent | mark-paid | mark-unpaid");
  },

  async estimate(p, f) {
    const sub = p[0] ?? "list";
    if (sub === "list") {
      const list = await call("GET", "estimates");
      const shown = list.filter((e) => !f.status || e.status === f.status);
      if (!f.json) table(["Estimate", "Client", "Status", "Issued", "Total"], shown.slice(0, Number(f.limit ?? 25)).map((e) => [e.number, e.customer?.name ?? "", e.status, shortDate(e.issueDate), money(e.total)]), f.status ? `No ${f.status} estimates.` : "No estimates yet.");
      return shown;
    }
    if (sub === "preview") {
      if (!p[1]) throw new UsageError("perhr estimate preview <EST-0001>");
      const r = await call("GET", `estimates/${encodeURIComponent(p[1])}/preview`);
      if (!f.json) printChecks(r.estimate, r.checks, r.canSend);
      return r;
    }
    if (sub === "open") {
      if (!p[1]) throw new UsageError("perhr estimate open <EST-0001>");
      const r = await call("GET", `estimates/${encodeURIComponent(p[1])}/preview`);
      openBrowser(`${loadConfig().api || "https://per.hr"}/invoices/estimates/${r.estimate.id}`);
      return { opened: r.estimate.id };
    }
    if (sub === "send") {
      if (!p[1]) throw new UsageError("perhr estimate send <EST-0001> [--test]");
      return sendThings("estimate", p.slice(1), f);
    }
    throw new UsageError("perhr estimate list | preview <EST> | open <EST> | send <EST> [--test]");
  },

  async team(p, f) {
    const sub = p[0] ?? "list";
    const t = await call("GET", "team");
    const findMember = (ref) => {
      if (!ref) throw new UsageError("Name the person (their name or email).");
      const r = String(ref).toLowerCase();
      const hits = t.members.filter((m) => m.email?.toLowerCase() === r || (m.name ?? "").toLowerCase() === r || (m.name ?? "").toLowerCase().startsWith(r) || m.email?.toLowerCase().startsWith(r));
      if (hits.length === 1) return hits[0];
      if (!hits.length) throw new UsageError(`Nobody named ${ref} on this team. See perhr team list.`);
      throw new UsageError(`Several people match ${ref}: ${hits.map((m) => m.name ?? m.email).join(", ")}.`);
    };
    if (sub === "list") {
      if (!f.json) {
        table(["Name", "Email", "Role", "Weekly Hours"], t.members.map((m) => [m.name ?? "", m.email ?? "", m.role, m.weeklyHours ?? ""]), "Nobody on this team yet.");
        if (t.invites?.length) {
          out(bold("\nInvited"));
          table(["Email", "Role", "Expires"], t.invites.map((i) => [i.email, i.role, shortDate(i.expiresAt)]));
        }
      }
      return t;
    }
    if (!t.canManage) throw new UsageError("Only the team's owners and admins can change the team.");
    if (sub === "invite") {
      const email = p[1] ?? (await value(f, "email", "Their email"));
      const role = await choose(f, "role", "Their role", [
        { id: "member", label: "Member", hint: "logs time on the projects you choose" },
        { id: "admin", label: "Admin", hint: "runs the team with you" },
        { id: "viewer", label: "Viewer", hint: "sees the work, logs nothing" },
      ]);
      let projectIds = [];
      if (typeof f.projects === "string") {
        const all = await call("GET", "projects");
        projectIds = f.projects.split(",").map((n) => {
          const hit = all.find((x) => x.name.toLowerCase() === n.trim().toLowerCase());
          if (!hit) throw new UsageError(`No project named ${n.trim()}.`);
          return hit.id;
        });
      }
      if (f["dry-run"]) return { dryRun: true, would: { email, role, projects: projectIds.length } };
      const r = await call("POST", "team/invites", { email, role, projectIds, ...(f.hours ? { weeklyHours: Number(f.hours) } : {}) });
      if (!f.json) out(green(`Invited ${email} as ${role}. The link works for 7 days.`));
      return r;
    }
    if (sub === "cancel") {
      const email = (p[1] ?? "").toLowerCase();
      const inv = t.invites?.find((i) => i.email.toLowerCase() === email);
      if (!inv) throw new UsageError(`No pending invite for ${p[1] ?? "that address"}.`);
      if (f["dry-run"]) return { dryRun: true, would: { cancel: inv.email } };
      await call("DELETE", `team/invites/${inv.id}`);
      if (!f.json) out(green(`Canceled the invite for ${inv.email}.`));
      return { ok: true };
    }
    if (sub === "role") {
      const m = findMember(p[1]);
      const role = p[2] ?? (await choose(f, "role", `New role for ${m.name ?? m.email}`, [
        { id: "member", label: "Member" },
        { id: "admin", label: "Admin" },
        { id: "viewer", label: "Viewer" },
      ]));
      if (f["dry-run"]) return { dryRun: true, would: { person: m.email, role } };
      await call("PATCH", `team/${m.id}`, { role });
      if (!f.json) out(green(`${m.name ?? m.email} is now ${role === "admin" ? "an admin" : `a ${role}`}.`));
      return { ok: true };
    }
    if (sub === "hours") {
      const m = findMember(p[1]);
      const n = Number(p[2]);
      if (!(n >= 1 && n <= 80)) throw new UsageError("perhr team hours <person> <weekly hours, 1 to 80>");
      if (f["dry-run"]) return { dryRun: true, would: { person: m.email, weeklyHours: n } };
      await call("PATCH", `team/${m.id}`, { weeklyHours: n });
      if (!f.json) out(green(`${m.name ?? m.email}: ${n} hours a week.`));
      return { ok: true };
    }
    if (sub === "remove") {
      const m = findMember(p[1]);
      if (!(await confirm(f, `Remove ${m.name ?? m.email} from the team? Their time stays.`, false))) return { cancelled: true };
      await call("DELETE", `team/${m.id}`);
      if (!f.json) out(green(`Removed ${m.name ?? m.email}.`));
      return { ok: true };
    }
    throw new UsageError("perhr team list | invite <email> --role member|admin|viewer [--projects A,B] | cancel <email> | role <person> <role> | hours <person> <n> | remove <person>");
  },

  async timesheets(p, f) {
    const sub = p[0] ?? "list";
    const week = typeof f.week === "string" ? f.week : undefined;
    if (sub === "submit" || sub === "withdraw") {
      const w = week ?? new Date().toISOString().slice(0, 10);
      if (f["dry-run"]) return { dryRun: true, would: { [sub]: w } };
      const r = await call("POST", "timesheets/submit", { week: w, ...(sub === "withdraw" ? { withdraw: true } : {}) });
      if (!f.json) out(green(sub === "submit" ? "Submitted for approval." : "Taken back."));
      return r;
    }
    const t = await call("GET", `timesheets/team${week ? `?week=${week}` : ""}`);
    if (sub === "list") {
      if (!f.json) {
        out(dim(`Week of ${t.week}`));
        table(["Name", "Hours", "Expected", "Status", "Behind"], t.rows.map((r) => [r.name, hours(r.hours), r.expected === null ? "" : hours(r.expected), r.status, r.behind ? "yes" : ""]), "Nobody logs time on this team.");
      }
      return t;
    }
    if (sub === "approve" || sub === "send-back" || sub === "reopen") {
      const action = sub === "approve" ? "approve" : sub === "send-back" ? "reject" : "reopen";
      let rows;
      if (f.all && sub === "approve") rows = t.rows.filter((r) => r.status === "submitted");
      else {
        const ref = (p[1] ?? "").toLowerCase();
        rows = t.rows.filter((r) => r.email.toLowerCase() === ref || r.name.toLowerCase() === ref || r.name.toLowerCase().startsWith(ref));
        if (rows.length !== 1) throw new UsageError(rows.length ? `Several people match ${p[1]}.` : `perhr timesheets ${sub} <person>${sub === "approve" ? " | --all" : ""} [--week YYYY-MM-DD]`);
      }
      if (!rows.length) {
        if (!f.json) out(dim("Nothing submitted to approve this week."));
        return { approved: 0 };
      }
      const note = action === "reject" ? await value(f, "note", "What needs fixing") : undefined;
      if (f["dry-run"]) return { dryRun: true, would: { action, week: t.week, people: rows.map((r) => r.name) } };
      const r = await call("POST", "timesheets/review", { userIds: rows.map((x) => x.userId), week: t.week, action, ...(note ? { note } : {}) });
      if (!f.json) out(green(`${{ approve: "Approved", reject: "Sent back", reopen: "Reopened" }[action]}: ${rows.map((x) => x.name).join(", ")} (week of ${t.week}).`));
      return r;
    }
    throw new UsageError("perhr timesheets [list] [--week YYYY-MM-DD] | approve <person> | approve --all | send-back <person> --note … | reopen <person> | submit | withdraw");
  },

  async pay(p, f) {
    const sub = p[0] ?? "list";
    const r = await call("GET", "pay");
    const rows = r.due.flatMap((d) => d.rows);
    if (sub === "list") {
      if (!f.json) {
        for (const d of r.due) {
          out(`${bold(`Paid on ${d.paidOn}`)}  ${money(d.total)}${d.readyTotal !== d.total ? dim(`  (${money(d.readyTotal)} ready)`) : ""}`);
          table(["Person", "Period", "Hours", "Total", "Status", "Payout"], d.rows.map((x) => [x.person.name, `${x.start} to ${x.end}`, hours(x.hours), money(x.total), x.status, x.payout?.label ?? ""]));
        }
        if (!r.due.length) out(dim("Nothing due."));
        else out(dim("\nper.hr keeps the record; you pay people from your own account. Mark them paid on per.hr's Pay page: perhr pay open"));
      }
      return r;
    }
    if (sub === "file") {
      const ready = rows.filter((x) => x.status === "ready" && ["paypal", "venmo"].includes(x.payout?.method));
      if (!ready.length) throw new UsageError("Nobody is ready to pay by PayPal or Venmo.");
      const outFile = typeof f.out === "string" ? f.out : `payouts-${new Date().toISOString().slice(0, 10)}.csv`;
      if (f["dry-run"]) return { dryRun: true, would: { file: outFile, people: ready.map((x) => x.person.name) } };
      const file = await call("POST", "pay/file", { ids: ready.map((x) => x.id) });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(outFile, file.csv, { mode: 0o600 });
      if (!f.json) {
        out(green(`Saved ${outFile}: ${file.included.length} ${file.included.length === 1 ? "payout" : "payouts"}, ${money(file.total)}.`));
        out(dim("Upload it in your PayPal business account (Payouts). Then mark them paid on per.hr: perhr pay open"));
      }
      return { file: outFile, included: file.included.length, skipped: file.skipped, total: file.total };
    }
    if (sub === "open" || sub === "mark-paid") {
      const base = loadConfig().api || "https://per.hr";
      openBrowser(`${base}/pay`);
      if (!f.json) out(`Opened per.hr's Pay page${sub === "mark-paid" ? ", where you mark people paid" : ""}.`);
      return { opened: true };
    }
    throw new UsageError("perhr pay [list] | file [--out payouts.csv] | open");
  },

  async statusline() {
    const { statusline } = await import("./statusline.js");
    await statusline();
    return undefined;
  },

  async open(p) {
    const base = loadConfig().api || "https://per.hr";
    openBrowser(`${base}/${p[0] === "review" ? "work/review" : p[0] === "plan" ? "work" : "dashboard"}`);
    return { ok: true };
  },
};

function printChecks(x, checks, canSend, sending = false) {
  out(`${bold(x.number)}  ${x.client ?? ""}  ${money(x.total)}  ${dim(x.status)}`);
  if (x.to?.length) out(`To: ${x.to.join(", ")}`);
  for (const c of checks) out(`  ${c.level === "stop" ? yellow("■ Stops the send:") : c.level === "warning" ? yellow("▲") : dim("i")} ${c.message}${c.fix ? dim(`  → ${c.fix}`) : ""}`);
  if (!sending) out(canSend ? green(`Ready to send: perhr ${x.number.toUpperCase().startsWith("EST") ? "estimate" : "invoice"} send ${x.number}`) : "Fix what stops the send first.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send invoices or estimates: preview each, then ask per.hr for an approval link and wait while the
 * person approves it in the browser. --test sends the exact email to you only, with no approval.
 */
async function sendThings(type, refs, f) {
  const path = type === "estimate" ? "estimates" : "invoices";
  // A reminder's preview and test live under the invoice
  const preview = (ref) => `${path}/${encodeURIComponent(ref)}/${type === "reminder" ? "remind" : "preview"}`;
  const testPath = (ref) => `${path}/${encodeURIComponent(ref)}/${type === "reminder" ? "remind/test" : "test"}`;
  if (f.test) {
    const results = [];
    for (const ref of refs) {
      const r = await call("POST", testPath(ref), {});
      results.push({ ref, sentTo: r.sentTo });
      if (!f.json) out(green(`Test ${type === "reminder" ? "reminder " : ""}for ${ref} sent to ${r.sentTo}.`));
    }
    return { test: true, results };
  }
  const items = [];
  for (const ref of refs) {
    const r = await call("GET", preview(ref));
    const x = r.invoice ?? r.estimate ?? r.reminder;
    if (!f.json) {
      printChecks(x, r.checks, r.canSend, true);
      if (type === "reminder") out(`${x.waiting}${x.lastReminderAt ? dim(`, last reminder ${shortDate(x.lastReminderAt)}`) : ""}`);
    }
    if (!r.canSend) throw new UsageError(`${x.number} can't be sent yet. Nothing was sent.`);
    items.push({ type, ref: x.id, fingerprint: x.fingerprint, number: x.number, total: x.total });
  }
  if (f["dry-run"]) return { dryRun: true, would: items.map((i) => i.number) };
  const a = await call("POST", "approvals", { items: items.map(({ type: t, ref, fingerprint }) => ({ type: t, ref, fingerprint })) });
  if (!f.json) {
    out("");
    out(`Approve ${items.length === 1 ? (type === "reminder" ? "the reminder" : "it") : `all ${items.length}`} in your browser: ${cyan(a.url)}`);
    out(dim("Nothing goes out until you approve it there. The link works on any device where you're signed in to per.hr, for 30 minutes."));
  }
  if (!f["no-browser"]) openBrowser(a.url);
  if (f["no-wait"]) return { approval: a };
  if (!f.json) process.stdout.write(dim("Waiting for your approval…"));
  const until = Date.parse(a.expiresAt);
  while (Date.now() < until) {
    await sleep(3000);
    const s = await call("GET", `approvals/${a.id}`);
    if (s.status === "pending") continue;
    if (!f.json) {
      out("");
      if (s.status === "denied") out(yellow("Denied. Nothing was sent."));
      else if (s.status === "expired") out(yellow("The approval expired. Nothing was sent."));
      else for (const r of s.result ?? []) out(r.ok ? `${green("Sent")} ${r.number} to ${r.sentTo}` : `${yellow("Not sent")} ${r.number}: ${r.error}`);
    }
    return { approval: a, ...s };
  }
  if (!f.json) out("");
  return { approval: a, status: "expired" };
}

// The plugin's session commands, answered by per.hr in plain text
export const SESSION = new Set(["start", "pause", "resume", "end", "done", "note"]);

export async function session(cmd, p, f) {
  const top = currentTop();
  const here = top ? gitRemote(top) : null;
  // The plugin's hook keeps this folder's current Claude Code session; folder-only keeps the remote here too
  const state = top ? repoState(top) : null;
  const text = await sessionCall({
    action: cmd,
    ...(cmd === "start" && p.length ? { ref: p.join(" ") } : {}),
    ...((cmd === "end" || cmd === "done" || cmd === "note") && (p.length || typeof f.summary === "string") ? { summary: typeof f.summary === "string" ? f.summary : p.join(" ") } : {}),
    ...(state?.session ? { sessionId: state.session } : {}),
    ...(here ? { remote: state?.folderOnly ? "" : (here.remote ?? ""), folder: here.root.split(/[\\/]/).pop() } : {}),
  });
  if (!f.json) out(text);
  return { reply: text };
}

export { choose };
