/**
 * READING THE OPERATION LOG (docs/OPERATION-LOG.md). The rows are written by
 * the database itself (migration CreateOperationLog2) with the context of
 * lib/operation-log-context.ts; this file only reads them, for the
 * «Registro de operaciones» tab (owner and superadmin only).
 *
 *   - filters: a time interval (required, at most 366 days), the store, the
 *     table, the operation, the person, where it came from, and a free text
 *     that looks inside the data too;
 *   - per column: a sort (click on the header) and a search (double click),
 *     always on the server, so they apply to the whole interval, not to the
 *     page on screen;
 *   - pages of up to 200 rows to read, up to 5,000 to export (Excel or PDF).
 *
 * The values a row carries are already cleaned by the trigger (no secrets, no
 * prescription values); the list returns a one-line summary of the change and
 * the full before/after comes with the row's own detail.
 */
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";

export const OPLOG_OPS = ["INSERT", "UPDATE", "DELETE", "SOFT_DELETE", "RESTORE", "TRUNCATE"] as const;
export const OPLOG_SOURCES = ["panel", "store", "auth", "api", "system"] as const;
export const OPLOG_PAGE_MAX = 200;
export const OPLOG_EXPORT_MAX = 5000;
export const OPLOG_MAX_DAYS = 366;
const DAY = 86_400_000;

/**
 * The columns of the table on screen: what each sorts by and searches in. The
 * keys are the only thing the client names — never a column of the database.
 */
const COLUMNS = {
  at: { sort: "l.at", search: "to_char(l.at, 'YYYY-MM-DD HH24:MI:SS')" },
  store: { sort: "e.code", search: "concat_ws(' ', e.code, e.name)" },
  actor: { sort: "actor_label", search: "concat_ws(' ', u.first_name, u.last_name, u.email, c.first_name, c.last_name, c.email, l.actor_id)" },
  role: { sort: "l.actor_role", search: "l.actor_role" },
  source: { sort: "l.source", search: "l.source" },
  op: { sort: "l.op", search: "l.op" },
  table: { sort: "l.table_name", search: "l.table_name" },
  row: { sort: "l.row_id", search: "l.row_id" },
  changed: { sort: "array_length(l.changed, 1)", search: "array_to_string(l.changed, ', ')" },
  route: { sort: "l.route", search: "concat_ws(' ', l.method, l.route)" },
  ip: { sort: "l.ip", search: "l.ip" },
  request: { sort: "l.request_id", search: "l.request_id" },
  data: { sort: "l.seq", search: "concat(l.before::text, ' ', l.after::text)" },
} as const;
export type OplogColumn = keyof typeof COLUMNS;
export const OPLOG_COLUMNS = Object.keys(COLUMNS) as OplogColumn[];

export interface OplogQuery {
  from: Date;
  to: Date;
  store: string | null;
  table: string | null;
  op: string | null;
  actor: string | null;
  source: string | null;
  /** Free text: any column, the data included. */
  q: string | null;
  /** Searches typed on a column header (double click). */
  col: Partial<Record<OplogColumn, string>>;
  sort: OplogColumn;
  dir: "asc" | "desc";
  page: number;
  limit: number;
  /** Export: a bigger page, same filters. */
  exporting: boolean;
}

const text = (v: unknown, n = 120): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, n) : null;
};

const dateOf = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.trim());
  return Number.isFinite(d.getTime()) ? d : null;
};

/**
 * The query string, cleaned. Without an interval, today (the last 24 hours);
 * an interval longer than a year is cut to the year that ends at `to`. Pure.
 */
export function cleanOplogQuery(raw: Record<string, unknown>, now: Date = new Date()): OplogQuery | { reason: string } {
  let to = dateOf(raw.to) ?? now;
  let from = dateOf(raw.from) ?? new Date(to.getTime() - DAY);
  if (from > to) [from, to] = [to, from];
  if (to.getTime() - from.getTime() > OPLOG_MAX_DAYS * DAY) from = new Date(to.getTime() - OPLOG_MAX_DAYS * DAY);

  const op = text(raw.op, 20)?.toUpperCase() ?? null;
  if (op && !(OPLOG_OPS as readonly string[]).includes(op)) return { reason: "bad_op" };
  const source = text(raw.source, 20)?.toLowerCase() ?? null;
  if (source && !(OPLOG_SOURCES as readonly string[]).includes(source)) return { reason: "bad_source" };
  const table = text(raw.table, 63);
  if (table && !/^[a-z0-9_]+$/.test(table)) return { reason: "bad_table" };

  const sort = (OPLOG_COLUMNS as string[]).includes(String(raw.sort)) ? (raw.sort as OplogColumn) : "at";
  const dir = String(raw.dir).toLowerCase() === "asc" ? "asc" : "desc";

  const col: OplogQuery["col"] = {};
  // ?col[actor]=ana  (express parses it into an object)  or  ?col.actor=ana
  const colRaw = raw.col && typeof raw.col === "object" ? (raw.col as Record<string, unknown>) : {};
  for (const k of OPLOG_COLUMNS) {
    const v = text(colRaw[k] ?? raw[`col.${k}`], 400);
    if (v) col[k] = v;
  }

  const exporting = raw.export === "1" || raw.export === "true" || raw.export === true;
  const max = exporting ? OPLOG_EXPORT_MAX : OPLOG_PAGE_MAX;
  const limit = Math.max(1, Math.min(max, Math.floor(Number(raw.limit) || (exporting ? OPLOG_EXPORT_MAX : 50))));
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(raw.page) || 1)));

  return { from, to, store: text(raw.store, 80), table, op, actor: text(raw.actor, 80), source, q: text(raw.q, 120), col, sort, dir, page, limit, exporting };
}

/** The alternatives of a column search («a|b|c», at most 12, empty ones dropped). Pure. */
export const searchAlternatives = (v: string): string[] => {
  const alts = [...new Set(v.split("|").map((x) => x.trim()).filter(Boolean))].slice(0, 12);
  return alts.length ? alts : [v];
};

/** `%text%` for ILIKE with the wildcards of the text itself escaped. Pure. */
export const likeOf = (s: string): string => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const short = (v: unknown, n = 60): string => {
  if (v === null || v === undefined) return "∅";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * One line that says what happened to the row: «status: draft → paid · amount_cents: 25000 → 48000».
 * An insert lists what it was created with; a delete what it had. Pure.
 */
export function summarizeChange(op: string, changed: string[] | null, before: Record<string, unknown> | null, after: Record<string, unknown> | null, max = 400): string {
  // Medusa keeps every amount twice (`raw_amount` beside `amount`): the copy says nothing new.
  const keys = (changed ?? []).filter((k) => !["created_at", "updated_at"].includes(k) && !k.startsWith("raw_"));
  let parts: string[];
  if (op === "UPDATE" || op === "SOFT_DELETE" || op === "RESTORE") parts = keys.map((k) => `${k}: ${short(before?.[k])} → ${short(after?.[k])}`);
  else if (op === "INSERT") parts = keys.filter((k) => k !== "id").map((k) => `${k}=${short(after?.[k], 40)}`);
  else if (op === "DELETE") parts = keys.filter((k) => k !== "id").map((k) => `${k}=${short(before?.[k], 40)}`);
  else parts = [];
  const out = parts.join(" · ");
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

export interface OplogRow {
  seq: string;
  at: string;
  txid: string;
  table: string;
  op: string;
  row_id: string | null;
  store_id: string | null;
  store_code: string | null;
  store_name: string | null;
  actor_id: string | null;
  actor_type: string | null;
  actor_label: string;
  actor_email: string | null;
  role: string | null;
  source: string;
  method: string | null;
  route: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  changed: string[];
  summary: string;
}

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/** The rows of the log with the joins the screen shows (person, store). */
function base(pg: Knex) {
  return pg({ l: "operation_log" })
    .leftJoin({ u: "user" }, function () {
      this.on("u.id", "=", "l.actor_id").andOn("l.actor_type", "=", pg.raw("'user'"));
    })
    .leftJoin({ c: "customer" }, function () {
      this.on("c.id", "=", "l.actor_id").andOn("l.actor_type", "=", pg.raw("'customer'"));
    })
    // A row with no store of its own (an order line, a capture…) takes the store
    // of the request it was written in: the sale row of the same request has it.
    .joinRaw(
      `LEFT JOIN LATERAL (SELECT x.establishment_id FROM operation_log x WHERE l.establishment_id IS NULL AND l.request_id IS NOT NULL AND x.request_id = l.request_id AND x.establishment_id IS NOT NULL LIMIT 1) rs ON true`
    )
    .leftJoin({ e: "establishment" }, "e.id", pg.raw("COALESCE(l.establishment_id, rs.establishment_id)"));
}

const ACTOR_LABEL = `COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, NULLIF(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.email, l.actor_id, 'system')`;

function filtered(pg: Knex, f: OplogQuery) {
  const b = base(pg).where("l.at", ">=", f.from).andWhere("l.at", "<=", f.to);
  if (f.store) b.andWhereRaw("COALESCE(l.establishment_id, rs.establishment_id) = ?", [f.store]);
  if (f.table) b.andWhere("l.table_name", f.table);
  if (f.op) b.andWhere("l.op", f.op);
  if (f.actor) b.andWhere("l.actor_id", f.actor);
  if (f.source) b.andWhere("l.source", f.source);
  for (const [k, v] of Object.entries(f.col) as Array<[OplogColumn, string]>) {
    // «a|b»: any of them (the screen sends the codes whose label matches what was typed, e.g. «Cambio» → UPDATE).
    const alts = searchAlternatives(v);
    b.andWhere(function () {
      for (const a of alts) this.orWhereRaw(`${COLUMNS[k].search} ILIKE ? ESCAPE '\\'`, [likeOf(a)]);
    });
  }
  if (f.q) {
    const like = likeOf(f.q);
    b.andWhere(function () {
      for (const k of OPLOG_COLUMNS) this.orWhereRaw(`${COLUMNS[k].search} ILIKE ? ESCAPE '\\'`, [like]);
    });
  }
  return b;
}

export interface OplogPage {
  rows: OplogRow[];
  total: number;
  page: number;
  limit: number;
  from: string;
  to: string;
  /** The tables and people that appear in the interval (for the filters' lists). */
  facets: { tables: Array<{ table: string; n: number }>; actors: Array<{ id: string; label: string; n: number }> };
}

const rowOf = (r: Record<string, unknown>): OplogRow => ({
  seq: String(r.seq),
  at: new Date(r.at as string).toISOString(),
  txid: String(r.txid),
  table: String(r.table_name),
  op: String(r.op),
  row_id: (r.row_id as string | null) ?? null,
  store_id: ((r.establishment_id ?? r.request_store_id) as string | null) ?? null,
  store_code: (r.store_code as string | null) ?? null,
  store_name: (r.store_name as string | null) ?? null,
  actor_id: (r.actor_id as string | null) ?? null,
  actor_type: (r.actor_type as string | null) ?? null,
  actor_label: String(r.actor_label ?? "system"),
  actor_email: ((r.user_email ?? r.customer_email) as string | null) ?? null,
  role: (r.actor_role as string | null) ?? null,
  source: String(r.source ?? "system"),
  method: (r.method as string | null) ?? null,
  route: (r.route as string | null) ?? null,
  ip: (r.ip as string | null) ?? null,
  user_agent: (r.user_agent as string | null) ?? null,
  request_id: (r.request_id as string | null) ?? null,
  changed: (r.changed as string[] | null) ?? [],
  summary: summarizeChange(String(r.op), (r.changed as string[] | null) ?? null, (r.before as Record<string, unknown> | null) ?? null, (r.after as Record<string, unknown> | null) ?? null),
});

export async function listOperationLog(container: MedusaContainer, f: OplogQuery): Promise<OplogPage> {
  const pg = pgOf(container);
  const sortExpr = f.sort === "actor" ? ACTOR_LABEL : COLUMNS[f.sort].sort;
  const rows = (await filtered(pg, f)
    .select(
      "l.seq", "l.at", "l.txid", "l.table_name", "l.op", "l.row_id", "l.establishment_id", "l.changed", "l.before", "l.after",
      "l.actor_id", "l.actor_type", "l.actor_role", "l.source", "l.method", "l.route", "l.ip", "l.user_agent", "l.request_id",
      { store_code: "e.code", store_name: "e.name", user_email: "u.email", customer_email: "c.email", request_store_id: "rs.establishment_id" },
      pg.raw(`${ACTOR_LABEL} AS actor_label`)
    )
    .orderByRaw(`${sortExpr} ${f.dir} NULLS LAST, l.seq ${f.dir}`)
    .limit(f.limit)
    .offset((f.page - 1) * f.limit)) as Array<Record<string, unknown>>;

  const [{ n }] = (await filtered(pg, f).count({ n: "*" })) as Array<{ n: string | number }>;

  let facets: OplogPage["facets"] = { tables: [], actors: [] };
  if (!f.exporting) {
    const inRange = () => pg({ l: "operation_log" }).where("l.at", ">=", f.from).andWhere("l.at", "<=", f.to);
    const tables = (await inRange().select("l.table_name").count({ n: "*" }).groupBy("l.table_name").orderBy("n", "desc").limit(200)) as Array<{ table_name: string; n: string }>;
    const actors = (await base(pg)
      .where("l.at", ">=", f.from)
      .andWhere("l.at", "<=", f.to)
      .whereNotNull("l.actor_id")
      .select("l.actor_id", pg.raw(`max(${ACTOR_LABEL}) AS label`))
      .count({ n: "*" })
      .groupBy("l.actor_id")
      .orderBy("n", "desc")
      .limit(200)) as Array<{ actor_id: string; label: string; n: string }>;
    facets = {
      tables: tables.map((t) => ({ table: t.table_name, n: Number(t.n) })),
      actors: actors.map((a) => ({ id: a.actor_id, label: a.label, n: Number(a.n) })),
    };
  }

  return { rows: rows.map(rowOf), total: Number(n) || 0, page: f.page, limit: f.limit, from: f.from.toISOString(), to: f.to.toISOString(), facets };
}

/** One row with its full before/after, and the other rows written by the same request and transaction. */
export async function getOperationLogEntry(container: MedusaContainer, seq: string): Promise<(OplogRow & { before: unknown; after: unknown; related: OplogRow[] }) | null> {
  if (!/^\d{1,19}$/.test(seq)) return null;
  const pg = pgOf(container);
  const select = (q: Knex.QueryBuilder) =>
    q.select(
      "l.*",
      { store_code: "e.code", store_name: "e.name", user_email: "u.email", customer_email: "c.email", request_store_id: "rs.establishment_id" },
      pg.raw(`${ACTOR_LABEL} AS actor_label`)
    );
  const [r] = (await select(base(pg).where("l.seq", seq))) as Array<Record<string, unknown>>;
  if (!r) return null;
  const related = (await select(base(pg))
    .where("l.txid", r.txid as string)
    .andWhereNot("l.seq", seq)
    .andWhere("l.at", ">=", new Date(new Date(r.at as string).getTime() - DAY))
    .andWhere("l.at", "<=", new Date(new Date(r.at as string).getTime() + DAY))
    .orderBy("l.seq", "asc")
    .limit(100)) as Array<Record<string, unknown>>;
  return { ...rowOf(r), before: r.before ?? null, after: r.after ?? null, related: related.map(rowOf) };
}

/**
 * Hourly (jobs/operation-log-maintain.ts): every table covered; with
 * OPLOG_RETENTION_DAYS (≥ 90) the older rows removed in batches. Never throws.
 */
export async function maintainOperationLog(container: MedusaContainer): Promise<{ attached: number; purged: number }> {
  const pg = pgOf(container);
  const log = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  let attached = 0;
  let purged = 0;
  try {
    const r = (await pg.raw(`SELECT oplog_attach_all() AS n`)) as { rows: Array<{ n: number }> };
    attached = Number(r.rows?.[0]?.n) || 0;
    if (attached) log.info(`[oplog] trigger added to ${attached} new table(s)`);
  } catch (e) {
    log.warn(`[oplog] attach: ${(e as Error).message}`);
    return { attached, purged };
  }
  const days = Math.floor(Number(process.env.OPLOG_RETENTION_DAYS) || 0);
  if (days >= 90) {
    try {
      for (let i = 0; i < 20; i++) {
        const n = await pg.transaction(async (trx) => {
          await trx.raw(`SET LOCAL oplog.purge = 'on'`);
          const res = (await trx.raw(
            `DELETE FROM operation_log WHERE seq IN (SELECT seq FROM operation_log WHERE at < now() - make_interval(days => ?) ORDER BY seq LIMIT 5000)`,
            [days]
          )) as { rowCount?: number };
          return res.rowCount ?? 0;
        });
        purged += n;
        if (n < 5000) break;
      }
      if (purged) log.info(`[oplog] ${purged} row(s) older than ${days} days removed`);
    } catch (e) {
      log.warn(`[oplog] retention: ${(e as Error).message}`);
    }
  }
  return { attached, purged };
}
