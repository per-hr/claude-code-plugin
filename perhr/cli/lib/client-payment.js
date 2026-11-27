import { call } from "./api.js";
import { bold, confirm, dim, green, out, tty, typed, value, yellow } from "./ui.js";

// A client's own payment details (per.hr Edit Client → Payment Details). Typed at the keyboard only:
// when Claude Code or a script runs perhr there's no keyboard, so perhr never asks, and per.hr turns
// these details away unless they come from one (like rates). Read back only in a terminal too.

const FIELDS = [
  ["paymentOther", "Payment instructions (bank transfer, a check address; Enter to skip)"],
  ["paymentZelle", "Zelle (email or phone; Enter to skip)"],
  ["paymentPaypal", "PayPal (email or paypal.me link; Enter to skip)"],
  ["paymentVenmo", "Venmo (@username; Enter to skip)"],
  ["paymentPayoneer", "Payoneer (payment link or receiving details; Enter to skip)"],
];

export const PAYMENT_HINT = (name) => `To give ${name} its own payment details, open Edit Client in per.hr, or run ${typed(`perhr client edit "${name}" --payment`)} in your own terminal.`;

/** Asks whether this client uses the default payment details; if not, asks for its own and saves them */
export async function askClientPayment(f, client, { ask = true } = {}) {
  if (!tty()) {
    if (!f.json) out(dim(PAYMENT_HINT(client.name)));
    return null;
  }
  if (ask && (await confirm(f, `Use your default payment details (Configure → Get Paid) for ${client.name}?`, true))) return null;
  out(dim(`${client.name}'s own details replace your defaults on its invoices. A way left blank isn't offered to ${client.name}.`));
  const body = { paymentOwn: true };
  for (const [key, question] of FIELDS) body[key] = (await value({}, key, question, { required: false })) || null;
  if (!FIELDS.some(([k]) => body[k])) {
    out(yellow(`Nothing entered, so ${client.name} keeps your default payment details.`));
    return null;
  }
  try {
    await call("PUT", `clients/${client.id}/payment`, body, { interactive: true });
  } catch (e) {
    out(yellow(e.message));
    return null;
  }
  out(green(`Saved. ${client.name}'s invoices show its own payment details.`));
  return body;
}

/** One line for perhr client show, and the details themselves when they came back (a terminal, someone allowed) */
export async function showClientPayment(client) {
  const p = await call("GET", `clients/${client.id}/payment`, undefined, { interactive: tty() }).catch(() => null);
  if (!p) return null;
  out(`Payment details: ${p.paymentOwn ? "this client's own" : "Default (Configure → Get Paid)"}`);
  if (p.paymentOwn && !p.hidden) for (const [key, q] of FIELDS) if (p[key]) out(`  ${bold(q.split(" (")[0])}: ${p[key]}`);
  return p;
}
