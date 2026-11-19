/**
 * WHO, FROM WHERE, THROUGH WHAT — the context of each write in the operation
 * log (migration CreateOperationLog2, lib/operation-log.ts).
 *
 * The database trigger that writes `operation_log` cannot know which person
 * or request caused a change: the connections are pooled. So the application
 * tells it, at no extra cost, inside the statement itself:
 *
 *   1. `opContextMiddleware` (every request) opens an AsyncLocalStorage with
 *      the request id, method, route, IP and device; `setOpActor` (called by
 *      the staff guard once the session is known) adds the user and role.
 *   2. `installOperationTagging` wraps the PostgreSQL client of knex (its
 *      prototype, so transactions and every module's connection are covered)
 *      and puts a comment in front of each INSERT/UPDATE/DELETE written while
 *      a context is open: `/*oplog:<base64url JSON>*\/`.
 *   3. The trigger reads it with `current_query()`.
 *
 * base64url keeps the comment free of anything that could close it or touch
 * the SQL; values are bounded. No extra round trip, nothing to remember in
 * each route. A write outside a request (jobs, scripts) carries no tag and is
 * logged as `system`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export interface OpContext {
  /** Request id (also sent back as `x-request-id`). */
  r: string;
  m: string;
  /** Route, without the query string. */
  p: string;
  ip: string | null;
  ua: string | null;
  /** panel | store | auth | api */
  s: string;
  /** Actor id, type and role, once known. */
  u?: string | null;
  t?: string | null;
  o?: string | null;
}

interface OpStore {
  ctx: OpContext;
  tag: string | null;
  /** The request: its `auth_context` is filled by Medusa's authentication AFTER this middleware ran. */
  req?: { auth_context?: { actor_id?: string; actor_type?: string } } | null;
}

const als = new AsyncLocalStorage<OpStore>();

/** The context of the current request, if any. */
export const currentOpContext = (): OpContext | null => als.getStore()?.ctx ?? null;

const cut = (v: unknown, n: number): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, n) : null;
};

/** Where a request comes from, by its path. Pure. */
export function sourceOf(path: string): string {
  if (path.startsWith("/admin")) return "panel";
  if (path.startsWith("/store")) return "store";
  if (path.startsWith("/auth")) return "auth";
  return "api";
}

/** The client's address: the first of X-Forwarded-For (the proxy in front), else the socket's. Pure. */
export function clientIp(forwarded: unknown, socketIp: unknown): string | null {
  const first = String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? "").split(",")[0].trim();
  return cut(first || socketIp, 64);
}

/** The context of a request. Pure. */
export function contextOf(req: { method?: string; originalUrl?: string; url?: string; headers?: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } }, id: string = randomUUID()): OpContext {
  const path = String(req.originalUrl ?? req.url ?? "").split("?")[0];
  return {
    r: id,
    m: String(req.method ?? "").toUpperCase().slice(0, 10),
    p: path.slice(0, 200),
    ip: clientIp(req.headers?.["x-forwarded-for"], req.ip ?? req.socket?.remoteAddress),
    ua: cut(req.headers?.["user-agent"], 200),
    s: sourceOf(path),
  };
}

/** The comment that tags a write: base64url of the context (letters, digits, - and _ only). Pure. */
export function tagOf(ctx: OpContext): string {
  const json = JSON.stringify(Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== null && v !== undefined)));
  return `/*oplog:${Buffer.from(json, "utf8").toString("base64url")}*/ `;
}

const WRITE = /^\s*(insert|update|delete|with|merge)\b/i;

/** The statement with the tag in front when it writes. Pure. */
export function taggedSql(sql: string, tag: string | null): string {
  return tag && WRITE.test(sql) && !sql.startsWith("/*oplog:") ? tag + sql : sql;
}

let installed = false;

/**
 * Wraps the PostgreSQL client's `_query` (once per process). `client` is any
 * knex instance's client: the wrap goes on its prototype, which every knex
 * PostgreSQL client and transaction shares.
 */
export function installOperationTagging(client: unknown): void {
  if (installed || !client) return;
  const proto = Object.getPrototypeOf(client) as { _query?: (conn: unknown, obj: { sql?: string }) => unknown; __oplog?: boolean } | null;
  if (!proto || typeof proto._query !== "function" || proto.__oplog) {
    installed = Boolean(proto?.__oplog);
    return;
  }
  const original = proto._query;
  proto._query = function oplogQuery(this: unknown, conn: unknown, obj: { sql?: string }) {
    const store = als.getStore();
    if (store && obj && typeof obj.sql === "string") {
      // The signed-in person (panel user or web customer), as soon as Medusa knows it.
      const auth = store.req?.auth_context;
      if (auth?.actor_id && store.ctx.u !== auth.actor_id) {
        store.ctx.u = cut(auth.actor_id, 80);
        store.ctx.t = cut(auth.actor_type, 20);
        store.tag = null;
      }
      if (store.tag === null) store.tag = tagOf(store.ctx);
      obj.sql = taggedSql(obj.sql, store.tag);
    }
    return original.call(this, conn, obj);
  };
  proto.__oplog = true;
  installed = true;
}

/** Every request: opens the context the writes are tagged with. */
export function opContextMiddleware(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  try {
    installOperationTagging((req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as { client?: unknown }).client);
  } catch {
    /* no database in this context: nothing to tag */
  }
  const ctx = contextOf(req as never);
  try {
    res.setHeader("x-request-id", ctx.r);
  } catch {
    /* headers already sent */
  }
  als.run({ ctx, tag: null, req: req as never }, () => next());
}

/** The person behind the current request (the staff guard calls it once the session is resolved). */
export function setOpActor(actorId: string | null | undefined, type: string | null | undefined, role?: string | null): void {
  const store = als.getStore();
  if (!store) return;
  store.ctx.u = cut(actorId, 80);
  store.ctx.t = cut(type, 20);
  store.ctx.o = cut(role, 20);
  store.tag = null;
}
