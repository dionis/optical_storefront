#!/usr/bin/env node
// Loads the owner's cost table ("Índice de gastos") through the admin API, with
// a superadmin's login: the same validation, audit and Sheet mirror as the panel.
// Writes nothing without --apply, and running it twice changes nothing new.
//
//   node scripts/load-cost-values.mjs --env staging                 show the plan
//   node scripts/load-cost-values.mjs --env staging --apply         write it
//   ... --commissions                                               also set everyone's commission
//   ... --env production --apply --confirm-production               the live store
//
// Credentials: ADMIN_EMAIL / ADMIN_PASSWORD, or asked with the password hidden.
// Never as an argument: arguments stay in the shell history.
//
// Not loaded: the fiscal provision (25% of positive profit). A percent rule would
// charge it on the net of every sale, even at a loss.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const SOURCE = "Índice de gastos de Ruby Lens";
const COST_RULES = [
  { kind: "order_fixed", match_key: "mantenimiento", label: "Mantenimiento técnico", amount: 5.67, unit: "fixed", notes: `${SOURCE}: $850 al mes / 150 pedidos estimados` },
  { kind: "order_fixed", match_key: "lab", label: "Corte y montaje por par", amount: 10, unit: "fixed", notes: SOURCE },
  { kind: "order_fixed", match_key: "transporte_lab_tech", label: "Transporte LAB-Tech", amount: 0, unit: "fixed", notes: SOURCE },
  { kind: "order_fixed", match_key: "customer_service", label: "Customer service", amount: 2, unit: "fixed", notes: `${SOURCE}: provisional` },
  { kind: "order_percent", match_key: "reserva_devoluciones", label: "Reserva para devoluciones", amount: 3, unit: "percent", notes: SOURCE },
  { kind: "order_percent", match_key: "payment_fee", label: "Comisión del cobro (porcentaje)", amount: 2.9, unit: "percent", notes: `${SOURCE}: estimado` },
  { kind: "payment_fixed", match_key: "payment_fee_fixed", label: "Comisión del cobro (fija por pedido)", amount: 0.3, unit: "fixed", notes: `${SOURCE}: estimado` },
];
// Only cards charge this: cash, Zelle and insurance keep what they have.
const CARD_FEE = { codes: ["credit", "debit"], fee_pct: 2.9, fee_fixed_cents: 30 };
const COMMISSION_PCT = 8;

const REWRITES = { staging: "/medusa-staging/:path*", production: "/medusa/:path*" };

function parseArgs(argv) {
  const known = new Set(["--apply", "--commissions", "--confirm-production"]);
  const args = { flags: new Set(), env: null, apiUrl: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env") args.env = argv[++i];
    else if (argv[i] === "--api-url") args.apiUrl = argv[++i];
    else if (known.has(argv[i])) args.flags.add(argv[i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

/** The backend of each environment, from the one file that already declares them. */
function apiUrlOf(env) {
  const source = REWRITES[env];
  if (!source) throw new Error("Say which backend: --env staging or --env production.");
  const path = fileURLToPath(new URL("../apps/capri-storefront/vercel.json", import.meta.url));
  const rewrite = JSON.parse(readFileSync(path, "utf8")).rewrites.find((r) => r.source === source);
  if (!rewrite) throw new Error(`No rewrite for ${source} in vercel.json.`);
  return rewrite.destination.replace("/:path*", "");
}

async function ask(question, { hidden = false } = {}) {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY === true });
  const answer = rl.question(question);
  muted = hidden;
  const value = await answer;
  rl.close();
  if (hidden) process.stdout.write("\n");
  return value.trim();
}

function client(baseUrl) {
  let token = null;
  const call = async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(`${method} ${path}: ${res.status} ${data.reason ?? data.message ?? ""}`.trim());
      error.status = res.status;
      throw error;
    }
    return data;
  };
  return { call, setToken: (t) => { token = t; } };
}

async function signIn(api, email, password) {
  let data;
  try {
    data = await api.call("POST", "/auth/user/emailpass", { email, password });
  } catch (e) {
    throw new Error(e.status === 401 || e.status === 400 ? "Wrong email or password." : `Could not sign in: ${e.message}`);
  }
  if (data.mfa_required) throw new Error("This account asks for a second factor, which this script does not handle. Load the values in the panel.");
  if (!data.token) throw new Error("The backend did not return a session.");
  api.setToken(data.token);
  const me = await api.call("GET", "/admin/team/me");
  if (me.is_admin !== true) throw new Error(`This account's role (${me.role ?? "none"}) cannot edit costs: use an owner or a superadmin.`);
  return me;
}

/**
 * The rules to send: the ones missing or different. An existing rule keeps its
 * name and order; its note now says where the amount came from. That also drops
 * the demo seed's note, or its clean mode would reset the rule to 0.
 */
function planRules(existing) {
  const byKey = new Map(existing.map((r) => [`${r.kind}:${r.match_key}`, r]));
  const plan = [];
  COST_RULES.forEach((wanted, i) => {
    const current = byKey.get(`${wanted.kind}:${wanted.match_key}`);
    if (!current) {
      plan.push({ before: null, rule: { ...wanted, active: true, sort_order: 1000 + i } });
    } else if (Number(current.amount) !== wanted.amount || current.active === false) {
      plan.push({ before: current, rule: { ...current, amount: wanted.amount, active: true, notes: wanted.notes } });
    }
  });
  return plan;
}

function planMethods(methods) {
  return methods
    .filter((m) => CARD_FEE.codes.includes(m.code))
    .filter((m) => Number(m.fee_pct) !== CARD_FEE.fee_pct || Number(m.fee_fixed_cents) !== CARD_FEE.fee_fixed_cents);
}

/** The profile wins over the seller record, so a person's different % is on either one. */
async function planCommissions(api) {
  const { sellers = [] } = await api.call("GET", "/admin/sellers");
  const { team = [] } = await api.call("GET", "/admin/team");
  const onSellers = sellers.filter((s) => Number(s.commission_pct) !== COMMISSION_PCT);
  const onProfiles = [];
  for (const member of team.filter((m) => m.role === "seller")) {
    const { profile } = await api.call("GET", `/admin/team/${encodeURIComponent(member.id)}/profile`);
    if (profile?.commission_pct != null && Number(profile.commission_pct) !== COMMISSION_PCT) onProfiles.push({ ...member, pct: profile.commission_pct });
  }
  return { onSellers, onProfiles };
}

const value = (r) => (r.unit === "percent" ? `${r.amount}%` : `$${Number(r.amount).toFixed(2)}`);
const fee = (pct, cents) => `${Number(pct)}% + $${(Number(cents) / 100).toFixed(2)}`;

function printPlan({ rules, methods, commissions }, setCommissions) {
  console.log("\nCost rules (Costs & prices):");
  if (!rules.length) console.log("  nothing to change");
  for (const { before, rule } of rules) {
    console.log(`  ${rule.label}: ${before ? `${value(before)}${before.active === false ? " (inactive)" : ""} -> ` : "new, "}${value(rule)}`);
  }
  console.log("\nCard fees (Point of sale -> payment methods):");
  if (!methods.length) console.log("  nothing to change");
  for (const m of methods) console.log(`  ${m.code}: ${fee(m.fee_pct, m.fee_fixed_cents)} -> ${fee(CARD_FEE.fee_pct, CARD_FEE.fee_fixed_cents)}`);
  console.log(`\nCommissions different from ${COMMISSION_PCT}%${setCommissions ? "" : " (left as they are without --commissions)"}:`);
  if (!commissions.onSellers.length && !commissions.onProfiles.length) console.log("  none");
  for (const s of commissions.onSellers) console.log(`  seller ${s.code ?? s.id}: ${s.commission_pct}%`);
  for (const m of commissions.onProfiles) console.log(`  team profile ${m.seller_code ?? m.id}: ${m.pct}%`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args.apiUrl ?? apiUrlOf(args.env)).replace(/\/$/, "");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("The password only travels over https.");
  }
  const apply = args.flags.has("--apply");
  const setCommissions = args.flags.has("--commissions");
  if (apply && args.env === "production" && !args.flags.has("--confirm-production")) {
    throw new Error("Writing to the live store also needs --confirm-production.");
  }

  console.log(`Backend: ${baseUrl}${args.env ? ` (${args.env})` : ""}`);
  const email = process.env.ADMIN_EMAIL || (await ask("Superadmin email: "));
  const password = process.env.ADMIN_PASSWORD || (await ask("Password: ", { hidden: true }));
  const api = client(baseUrl);
  const me = await signIn(api, email, password);
  console.log(`Signed in as ${me.email} (${me.role}).`);

  // Opening the rules seeds the defaults when the table is empty, as the panel does.
  const { rules: existing = [] } = await api.call("GET", "/admin/costing/rules");
  const { payment_methods: paymentMethods = [] } = await api.call("GET", "/admin/pos/payment-methods");
  const plan = { rules: planRules(existing), methods: planMethods(paymentMethods), commissions: await planCommissions(api) };
  printPlan(plan, setCommissions);
  console.log("\nNot loaded: fiscal provision (25% of positive profit); the panel has no such calculation.");

  if (!apply) {
    console.log("\nNothing was written. Run it again with --apply.");
    return;
  }

  if (plan.rules.length) await api.call("PUT", "/admin/costing/rules", { rules: plan.rules.map((p) => p.rule) });
  for (const m of plan.methods) {
    await api.call("POST", `/admin/pos/payment-methods/${encodeURIComponent(m.id)}`, { fee_pct: CARD_FEE.fee_pct, fee_fixed: CARD_FEE.fee_fixed_cents / 100 });
  }
  if (setCommissions) {
    for (const s of plan.commissions.onSellers) await api.call("PATCH", `/admin/sellers/${encodeURIComponent(s.id)}`, { commission_pct: COMMISSION_PCT });
    for (const m of plan.commissions.onProfiles) await api.call("POST", `/admin/team/${encodeURIComponent(m.id)}/profile`, { commission_pct: COMMISSION_PCT });
  }

  // What the backend holds now, not what was sent.
  const { rules: after = [] } = await api.call("GET", "/admin/costing/rules");
  const { payment_methods: methodsAfter = [] } = await api.call("GET", "/admin/pos/payment-methods");
  const left = planRules(after).length + planMethods(methodsAfter).length;
  if (left) throw new Error(`${left} values did not stick: check them in the panel.`);
  console.log("\nDone: the backend now holds these values.");
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}`);
  // Not process.exit(): on Windows it aborts Node while fetch still holds its sockets.
  process.exitCode = 1;
});
