/**
 * The operation log (docs/OPERATION-LOG.md): the tag every write carries
 * (lib/operation-log-context.ts) and the reading of the log
 * (lib/operation-log.ts). The trigger itself is SQL (migration
 * CreateOperationLog2) and is exercised against PostgreSQL in the QA run.
 */
import { clientIp, contextOf, installOperationTagging, opContextMiddleware, setOpActor, sourceOf, taggedSql, tagOf } from "../src/lib/operation-log-context";
import { cleanOplogQuery, likeOf, OPLOG_EXPORT_MAX, OPLOG_PAGE_MAX, searchAlternatives, summarizeChange } from "../src/lib/operation-log";

const decode = (sql: string) => {
  const m = /^\/\*oplog:([A-Za-z0-9_-]+)\*\/ /.exec(sql);
  return m ? JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) : null;
};

describe("operation log context", () => {
  it("knows where a request comes from", () => {
    expect(sourceOf("/admin/pos/sales")).toBe("panel");
    expect(sourceOf("/store/carts/1")).toBe("store");
    expect(sourceOf("/auth/user/emailpass")).toBe("auth");
    expect(sourceOf("/hooks/stripe")).toBe("api");
  });

  it("takes the client's address from the proxy header, first hop", () => {
    expect(clientIp("203.0.113.9, 10.0.0.2", "10.0.0.2")).toBe("203.0.113.9");
    expect(clientIp(undefined, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp(["198.51.100.1"], null)).toBe("198.51.100.1");
    expect(clientIp("", "")).toBeNull();
  });

  it("builds the context without the query string and with bounded values", () => {
    const c = contextOf({ method: "post", originalUrl: "/admin/pos/sales?x=1", headers: { "user-agent": "x".repeat(500) }, ip: "1.2.3.4" }, "req-1");
    expect(c).toEqual({ r: "req-1", m: "POST", p: "/admin/pos/sales", ip: "1.2.3.4", ua: "x".repeat(200), s: "panel" });
  });

  it("tags writes only, with base64url that cannot close the comment", () => {
    const tag = tagOf({ r: "1", m: "POST", p: "/admin/x*/; drop table y; --", ip: null, ua: "é */", s: "panel", u: "user_1", t: "user", o: "owner" });
    expect(tag).toMatch(/^\/\*oplog:[A-Za-z0-9_-]+\*\/ $/);
    const sql = taggedSql('insert into "pos_sale" ("id") values (?)', tag);
    expect(decode(sql)).toEqual({ r: "1", m: "POST", p: "/admin/x*/; drop table y; --", ua: "é */", s: "panel", u: "user_1", t: "user", o: "owner" });
    expect(taggedSql("  UPDATE x set a = 1", tag).startsWith("/*oplog:")).toBe(true);
    expect(taggedSql("with q as (select 1) delete from x", tag).startsWith("/*oplog:")).toBe(true);
    expect(taggedSql("select * from x", tag)).toBe("select * from x");
    expect(taggedSql(tag + "insert into x", tag)).toBe(tag + "insert into x");
    expect(taggedSql("insert into x", null)).toBe("insert into x");
  });

  it("puts the request's tag (and the signed-in person) on every write made while it runs", async () => {
    class FakeClient {
      seen: string[] = [];
      _query(_conn: unknown, obj: { sql: string }) {
        this.seen.push(obj.sql);
        return Promise.resolve();
      }
    }
    const client = new FakeClient();
    const req: { method: string; originalUrl: string; headers: Record<string, string>; ip: string; scope: { resolve: () => unknown }; auth_context?: { actor_id: string; actor_type: string } } = {
      method: "POST",
      originalUrl: "/admin/pos/sales",
      headers: {},
      ip: "9.9.9.9",
      scope: { resolve: () => ({ client }) },
    };
    const resMock = { setHeader: jest.fn() };
    const res = resMock as never;
    await new Promise<void>((done) => {
      opContextMiddleware(req as never, res, async () => {
        await client._query(null, { sql: "insert into a values (1)" });
        // Medusa's authentication fills auth_context after this middleware…
        req.auth_context = { actor_id: "user_9", actor_type: "user" };
        await client._query(null, { sql: "update a set b = 2" });
        // …and the staff guard adds the role.
        setOpActor("user_9", "user", "seller");
        await client._query(null, { sql: "delete from a" });
        await client._query(null, { sql: "select 1" });
        done();
      });
    });
    // Outside the request: untouched.
    await client._query(null, { sql: "insert into a values (2)" });
    const [a, b, c, d, e] = client.seen;
    expect(decode(a)).toMatchObject({ m: "POST", p: "/admin/pos/sales", ip: "9.9.9.9", s: "panel" });
    expect(decode(a).u).toBeUndefined();
    expect(decode(b)).toMatchObject({ u: "user_9", t: "user" });
    expect(decode(c)).toMatchObject({ u: "user_9", t: "user", o: "seller" });
    expect(d).toBe("select 1");
    expect(e).toBe("insert into a values (2)");
    expect(resMock.setHeader).toHaveBeenCalledWith("x-request-id", decode(a).r);
    // Installing twice does not wrap twice.
    installOperationTagging(client);
    await new Promise<void>((done) => opContextMiddleware(req as never, res, async () => { await client._query(null, { sql: "insert into z" }); done(); }));
    expect(client.seen[client.seen.length - 1].match(/\/\*oplog:/g)).toHaveLength(1);
  });
});

describe("reading the operation log", () => {
  const now = new Date("2026-11-15T20:00:00Z");

  it("defaults to the last 24 hours, newest first, 50 rows", () => {
    const q = cleanOplogQuery({}, now);
    if ("reason" in q) throw new Error(q.reason);
    expect(q.to.toISOString()).toBe(now.toISOString());
    expect(q.from.toISOString()).toBe("2026-11-14T20:00:00.000Z");
    expect(q).toMatchObject({ sort: "at", dir: "desc", page: 1, limit: 50, exporting: false, col: {} });
  });

  it("swaps a reversed interval and cuts one longer than a year", () => {
    const a = cleanOplogQuery({ from: "2026-11-15T00:00:00Z", to: "2026-11-01T00:00:00Z" }, now);
    if ("reason" in a) throw new Error(a.reason);
    expect(a.from < a.to).toBe(true);
    const b = cleanOplogQuery({ from: "2020-01-01T00:00:00Z", to: "2026-11-15T00:00:00Z" }, now);
    if ("reason" in b) throw new Error(b.reason);
    expect((b.to.getTime() - b.from.getTime()) / 86_400_000).toBe(366);
  });

  it("accepts only known operations, sources, tables and columns", () => {
    expect(cleanOplogQuery({ op: "drop" }, now)).toEqual({ reason: "bad_op" });
    expect(cleanOplogQuery({ source: "x" }, now)).toEqual({ reason: "bad_source" });
    expect(cleanOplogQuery({ table: "pos_sale; drop" }, now)).toEqual({ reason: "bad_table" });
    const q = cleanOplogQuery({ op: "soft_delete", source: "PANEL", table: "pos_sale", sort: "1;drop", dir: "ASC", col: { actor: " ana ", nope: "x", data: "" } }, now);
    if ("reason" in q) throw new Error(q.reason);
    expect(q).toMatchObject({ op: "SOFT_DELETE", source: "panel", table: "pos_sale", sort: "at", dir: "asc", col: { actor: "ana" } });
  });

  it("caps pages: 200 to read, 5,000 to export", () => {
    const a = cleanOplogQuery({ limit: "9999", page: "0" }, now);
    const b = cleanOplogQuery({ export: "1", limit: "999999" }, now);
    if ("reason" in a || "reason" in b) throw new Error("bad");
    expect(a.limit).toBe(OPLOG_PAGE_MAX);
    expect(a.page).toBe(1);
    expect(b.limit).toBe(OPLOG_EXPORT_MAX);
    expect(b.exporting).toBe(true);
  });

  it("escapes the LIKE wildcards of what was typed and splits alternatives", () => {
    expect(likeOf("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
    expect(searchAlternatives("Cambio|UPDATE| |UPDATE")).toEqual(["Cambio", "UPDATE"]);
    expect(searchAlternatives("ana")).toEqual(["ana"]);
  });

  it("summarizes a change in one line", () => {
    expect(summarizeChange("UPDATE", ["amount_cents", "method_code", "updated_at"], { amount_cents: 25000, method_code: "cash" }, { amount_cents: 48000, method_code: "credit" })).toBe("amount_cents: 25000 → 48000 · method_code: cash → credit");
    expect(summarizeChange("INSERT", ["id", "amount", "raw_amount", "created_at"], null, { id: "p1", amount: 5, raw_amount: { value: "5" } })).toBe("amount=5");
    expect(summarizeChange("DELETE", ["id", "kind"], { id: "x", kind: "deposit" }, null)).toBe("kind=deposit");
    expect(summarizeChange("SOFT_DELETE", ["deleted_at"], { deleted_at: null }, { deleted_at: "2026-11-15" })).toBe("deleted_at: ∅ → 2026-11-15");
    expect(summarizeChange("TRUNCATE", null, null, null)).toBe("");
    expect(summarizeChange("UPDATE", ["note"], { note: "a" }, { note: "b".repeat(600) }, 50).length).toBe(50);
  });
});
