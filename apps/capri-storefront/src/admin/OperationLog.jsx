// Dónde se usa: pestaña «Registro de operaciones» de /admin (grupo
// Administración: solo dueño y superadmin). Cada escritura en la base de datos
// — alta, cambio, borrado — con quién, con qué rol, desde qué pantalla, IP y
// equipo, y qué tenía antes y después (docs/OPERATION-LOG.md; la escribe la
// propia base de datos, ver la migración CreateOperationLog2).
//
// La tabla:
//   · CLIC en un encabezado → ordena por esa columna (asc / desc, alterna);
//   · DOBLE CLIC → abre un buscador en el encabezado: «contiene…» en esa
//     columna (Enter aplica, Esc cancela). Varias columnas a la vez; cada
//     búsqueda activa sale como una pastilla que se quita con su ×.
//   El orden y las búsquedas se hacen en el SERVIDOR: valen para todo el
//   intervalo, no solo para la página que se ve.
//   · clic en una fila → el detalle: campo por campo antes/después, los datos
//     completos y las demás operaciones de la misma transacción.
//
// La tienda y el período son los de la barra de filtros del panel (y la hora
// de inicio y fin se afinan aquí); la barra exporta lo filtrado a PDF, Excel y
// CSV (hasta 5.000 filas por archivo, con aviso si hay más).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { T } from "../i18n/translations.js";
import { adminFetch } from "./adminApi.js";
import { isDemoLogin } from "./adminAuth.js";
import Icon from "./icons.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { boundsOf, usePeriodFilter } from "./periodStore.js";
import { useRegisterExport } from "./GlobalFilterBar.jsx";
import { exportReport } from "./ReportDoc.jsx";
import "./operation-log.css";

/** Columnas de la tabla, en orden. `w` = ancho mínimo orientativo. */
const COLS = [
  { key: "at", w: 150 },
  { key: "actor", w: 150 },
  { key: "role", w: 90 },
  { key: "op", w: 110 },
  { key: "table", w: 160 },
  { key: "changed", w: 260 },
  { key: "store", w: 80 },
  { key: "row", w: 150 },
  { key: "source", w: 90 },
  { key: "route", w: 200 },
  { key: "ip", w: 100 },
];
const OPS = ["INSERT", "UPDATE", "DELETE", "SOFT_DELETE", "RESTORE", "TRUNCATE"];
const SOURCES = ["panel", "store", "auth", "api", "system"];
const OP_TONE = { INSERT: "ok", UPDATE: "", DELETE: "bad", SOFT_DELETE: "warn", RESTORE: "gold", TRUNCATE: "bad" };
const ROLES = ["owner", "superadmin", "supervisor", "manager", "seller", "admin", "inactive"];
/** Las tablas con nombre en pantalla (i18n/parts/operation-log.js): para buscar por ese nombre. */
const TABLE_CODES = Object.keys(T.es).filter((k) => k.startsWith("adm.oplog.tbl.")).map((k) => k.slice("adm.oplog.tbl.".length));
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const PAGE_SIZES = [25, 50, 100, 200];
const CLICK_DELAY = 240;
const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const locale = (lang) => (lang === "en" ? "en-US" : "es-ES");
const fmtAt = (v, lang) => new Date(v).toLocaleString(locale(lang), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtInt = (n, lang) => Number(n || 0).toLocaleString(locale(lang));

/** Un valor del registro tal como se lee: los marcadores del disparador, traducidos. */
function useValueText() {
  const { t } = useLang();
  return useCallback((v) => {
    if (v === undefined) return "";
    if (v === null) return "∅";
    if (v === "[health data]") return `🔒 ${t("adm.oplog.d.health")}`;
    if (v === "[redacted]") return `🔒 ${t("adm.oplog.d.redacted")}`;
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v._truncated === "number") return t("adm.oplog.d.truncated", { n: v._truncated });
    if (typeof v === "object") return JSON.stringify(v, null, 1);
    return String(v);
  }, [t]);
}

/** Los textos de la fila (pantalla, PDF, Excel): nombre de tabla, persona, rol, operación, origen. */
function useLabels() {
  const { t } = useLang();
  return useMemo(() => {
    const opt = (k, fallback) => { const s = t(k); return s === k ? fallback : s; };
    return {
      table: (n) => opt(`adm.oplog.tbl.${n}`, n),
      op: (o) => opt(`adm.oplog.op.${o}`, o),
      source: (s) => opt(`adm.oplog.src.${s}`, s),
      role: (r) => (r ? opt(`adm.oplog.role.${r}`, r) : "—"),
      actor: (r) => (r.actor_id ? (r.actor_type === "customer" ? `${r.actor_label} · ${t("adm.oplog.customer")}` : r.actor_label) : t("adm.oplog.system")),
      store: (r) => r.store_code || "—",
      route: (r) => (r.route ? `${r.method || ""} ${r.route}`.trim() : "—"),
    };
  }, [t]);
}

/**
 * Encabezado que ordena con un clic y busca con doble clic. El clic espera
 * CLICK_DELAY ms: si llega el segundo clic no ordena (si no, un doble clic
 * ordenaría dos veces antes de abrir el buscador).
 */
function OpTh({ col, label, sort, onSort, search, onSearch, w }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(search || "");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (!editing) setDraft(search || ""); }, [search, editing]);
  const on = sort.key === col;
  const click = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSort(col), CLICK_DELAY);
  };
  const dbl = () => {
    clearTimeout(timer.current);
    setDraft(search || "");
    setEditing(true);
  };
  const apply = () => { setEditing(false); onSearch(col, draft.trim()); };
  return (
    <th scope="col" style={{ minWidth: w }} className={`ol-th ${on ? "on" : ""} ${search ? "searched" : ""}`} aria-sort={on ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
      {editing ? (
        <div className="ol-th-search">
          <Icon name="search" size={13} />
          <input
            autoFocus
            value={draft}
            maxLength={120}
            placeholder={t("adm.oplog.th.searchPh")}
            aria-label={t("adm.oplog.th.search", { col: label })}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
              else if (e.key === "Escape") { setEditing(false); setDraft(search || ""); }
            }}
            onBlur={apply}
          />
        </div>
      ) : (
        <span className="ol-th-row">
          <button type="button" className="ol-th-btn" onClick={click} onDoubleClick={dbl} title={t("adm.oplog.th.help", { col: label })}>
            <span>{label}</span>
            <span className="ol-arr" aria-hidden="true">{on ? (sort.dir === "desc" ? "▼" : "▲") : "▲▼"}</span>
          </button>
          {/* En pantalla táctil el doble toque no siempre llega: la lupa abre el mismo buscador. */}
          <button type="button" className={`ol-th-find ${search ? "on" : ""}`} onClick={dbl} aria-label={t("adm.oplog.th.search", { col: label })} title={t("adm.oplog.th.search", { col: label })}>
            <Icon name="search" size={12} />
          </button>
        </span>
      )}
    </th>
  );
}

/** El detalle de una operación, en un panel lateral. */
function OpDetail({ seq, onClose, onOpen }) {
  const { t, lang } = useLang();
  const L = useLabels();
  const vt = useValueText();
  const [state, setState] = useState({ s: "loading" });
  useEffect(() => {
    let on = true;
    setState({ s: "loading" });
    adminFetch(`/admin/operation-log/${encodeURIComponent(seq)}`)
      .then((r) => on && setState({ s: "ok", e: r.entry }))
      .catch(() => on && setState({ s: "error" }));
    return () => { on = false; };
  }, [seq]);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const e = state.e;
  const fields = useMemo(() => {
    if (!e) return [];
    const keys = e.changed?.length ? e.changed : Object.keys({ ...(e.before || {}), ...(e.after || {}) });
    return keys.map((k) => ({ k, b: e.before ? e.before[k] : undefined, a: e.after ? e.after[k] : undefined }));
  }, [e]);
  const two = e && (e.op === "UPDATE" || e.op === "SOFT_DELETE" || e.op === "RESTORE");
  return createPortal(
    <div className="ol-drawer-wrap">
      <div className="ol-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="ol-drawer" role="dialog" aria-modal="true" aria-label={t("adm.oplog.d.title", { seq })}>
        <header className="ol-drawer-head">
          <div>
            <small>{t("adm.oplog.d.title", { seq })}</small>
            {e && (
              <h3>
                <span className={`adm-chip ${OP_TONE[e.op] || ""}`}>{L.op(e.op)}</span> {L.table(e.table)}
              </h3>
            )}
          </div>
          <button type="button" className="ol-x" onClick={onClose} aria-label={t("adm.oplog.d.close")} title={t("adm.oplog.d.close")}><Icon name="close" size={16} /></button>
        </header>
        {state.s === "loading" && <div className="adm-src-note loading">{t("adm.oplog.loading")}</div>}
        {state.s === "error" && <div className="adm-demo-banner">{t("adm.oplog.d.loadFailed")}</div>}
        {e && (
          <div className="ol-drawer-body">
            <dl className="ol-meta">
              <dt>{t("adm.oplog.d.when")}</dt><dd>{fmtAt(e.at, lang)}</dd>
              <dt>{t("adm.oplog.d.who")}</dt><dd>{L.actor(e)}{e.actor_email && e.actor_email !== e.actor_label ? <small> · {e.actor_email}</small> : null}</dd>
              <dt>{t("adm.oplog.d.role")}</dt><dd>{L.role(e.role)}</dd>
              <dt>{t("adm.oplog.d.store")}</dt><dd>{e.store_code ? `${e.store_code} · ${e.store_name || ""}` : "—"}</dd>
              <dt>{t("adm.oplog.d.source")}</dt><dd>{L.source(e.source)}</dd>
              <dt>{t("adm.oplog.d.route")}</dt><dd><code>{L.route(e)}</code></dd>
              <dt>{t("adm.oplog.d.ip")}</dt><dd>{e.ip || "—"}</dd>
              <dt>{t("adm.oplog.d.device")}</dt><dd className="ol-ua">{e.user_agent || "—"}</dd>
              <dt>{t("adm.oplog.d.row")}</dt><dd><code>{e.row_id || "—"}</code></dd>
              <dt>{t("adm.oplog.d.request")}</dt><dd><code>{e.request_id || "—"}</code></dd>
              <dt>{t("adm.oplog.d.txid")}</dt><dd><code>{e.txid}</code></dd>
            </dl>
            <h4>{t("adm.oplog.d.changes")}</h4>
            <div className="adm-table-wrap">
              <table className="adm-table ol-diff">
                <thead>
                  <tr>
                    <th>{t("adm.oplog.d.field")}</th>
                    {two ? <><th>{t("adm.oplog.d.before")}</th><th>{t("adm.oplog.d.after")}</th></> : <th>{t("adm.oplog.d.value")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.k}>
                      <td><code>{f.k}</code></td>
                      {two ? (
                        <><td className="ol-v before"><pre>{vt(f.b)}</pre></td><td className="ol-v after"><pre>{vt(f.a)}</pre></td></>
                      ) : (
                        <td className="ol-v"><pre>{vt(e.op === "DELETE" ? f.b : f.a)}</pre></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="ol-raw">
              <summary>{t("adm.oplog.d.raw")}</summary>
              <pre>{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
            </details>
            <h4>{t("adm.oplog.d.related", { n: e.related.length })}</h4>
            {e.related.length === 0 ? (
              <p className="muted">{t("adm.oplog.d.noRelated")}</p>
            ) : (
              <ul className="ol-related">
                {e.related.map((r) => (
                  <li key={r.seq}>
                    <button type="button" onClick={() => onOpen(r.seq)}>
                      <span className={`adm-chip ${OP_TONE[r.op] || ""}`}>{L.op(r.op)}</span>
                      <b>{L.table(r.table)}</b>
                      <small>{r.summary || r.row_id}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </div>,
    document.body
  );
}

/** Props: `me` (GET /admin/team/me) para el filtro de tienda. */
export default function OperationLog({ me }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const L = useLabels();
  const sf = useStoreFilter(me);
  // La tienda online elegida en la barra es su establecimiento (si el dueño la lleva como tienda).
  const storeParam = sf.isAll ? "" : sf.establishmentId || "";
  const storeObj = sf.isAll ? null : sf.stores.find((s) => s.id === storeParam) || null;
  const { range } = usePeriodFilter();
  const [hourFrom, setHourFrom] = useState("00:00");
  const [hourTo, setHourTo] = useState("23:59");
  const [sort, setSort] = useState({ key: "at", dir: "desc" });
  const [col, setCol] = useState({});
  const [op, setOp] = useState("");
  const [table, setTable] = useState("");
  const [actor, setActor] = useState("");
  const [source, setSource] = useState("");
  const [qText, setQText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [data, setData] = useState({ s: demo ? "demo" : "loading", rows: [], total: 0, facets: { tables: [], actors: [] } });
  const [open, setOpen] = useState(null);
  // Una exportación a la vez (un doble clic en la barra no saca dos archivos).
  const exporting = useRef(false);
  const [reload, setReload] = useState(0);

  // La búsqueda libre espera a que se deje de escribir.
  useEffect(() => { const id = setTimeout(() => setQ(qText.trim()), 400); return () => clearTimeout(id); }, [qText]);

  const interval = useMemo(() => {
    const b = boundsOf(range);
    const [fh, fm] = (HOUR_RE.test(hourFrom) ? hourFrom : "00:00").split(":").map(Number);
    const [th, tm] = (HOUR_RE.test(hourTo) ? hourTo : "23:59").split(":").map(Number);
    const from = new Date(b.from); from.setHours(fh, fm, 0, 0);
    const to = new Date(b.to); to.setHours(th, tm, 59, 999);
    return { from, to };
  }, [range, hourFrom, hourTo]);

  // Lo que se escribe en Operación, Origen, Rol o Tabla se busca también por su
  // nombre en pantalla: «Cambio» encuentra UPDATE, «Paciente» la tabla customer.
  const queryOf = useCallback((k, v) => {
    if (!v) return "";
    const n = norm(v);
    const codes = k === "op" ? OPS : k === "source" ? SOURCES : k === "role" ? ROLES : k === "table" ? TABLE_CODES : null;
    if (!codes) return v;
    const label = k === "op" ? L.op : k === "source" ? L.source : k === "role" ? L.role : L.table;
    const hits = codes.filter((c) => norm(label(c)).includes(n));
    return [v, ...hits].join("|");
  }, [L]);
  const params = useCallback((extra = {}) => {
    const p = new URLSearchParams();
    p.set("from", interval.from.toISOString());
    p.set("to", interval.to.toISOString());
    if (storeParam) p.set("store", storeParam);
    if (op) p.set("op", op);
    if (table) p.set("table", table);
    if (actor) p.set("actor", actor);
    if (source) p.set("source", source);
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(col)) if (v) p.set(`col[${k}]`, queryOf(k, v));
    p.set("sort", sort.key);
    p.set("dir", sort.dir);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return p.toString();
  }, [interval, storeParam, op, table, actor, source, q, col, sort, queryOf]);

  // Otro filtro = de vuelta a la primera página.
  useEffect(() => { setPage(1); }, [interval, storeParam, op, table, actor, source, q, col, sort, limit]);

  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    setData((d) => ({ ...d, s: "loading" }));
    adminFetch(`/admin/operation-log?${params({ page, limit })}`)
      .then((r) => on && setData({ s: "ok", rows: r.rows || [], total: r.total || 0, facets: r.facets || { tables: [], actors: [] } }))
      .catch(() => on && setData((d) => ({ ...d, s: "error" })));
    return () => { on = false; };
  }, [params, page, limit, demo, reload]);

  const onSort = useCallback((k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "at" ? "desc" : "asc" })), []);
  const onSearch = useCallback((k, v) => setCol((c) => {
    const next = { ...c };
    if (v) next[k] = v; else delete next[k];
    return next;
  }), []);
  const clearAll = () => { setCol({}); setOp(""); setTable(""); setActor(""); setSource(""); setQText(""); setQ(""); setHourFrom("00:00"); setHourTo("23:59"); };
  const anyFilter = Object.keys(col).length || op || table || actor || source || qText || hourFrom !== "00:00" || hourTo !== "23:59";

  const colLabel = (k) => t(`adm.oplog.col.${k}`);
  const pages = Math.max(1, Math.ceil(data.total / limit));
  const intervalText = `${fmtAt(interval.from, lang)} → ${fmtAt(interval.to, lang)}`;

  // ── Exportar (barra de filtros): las mismas filas que la pantalla, hasta 5.000. ──
  const filtersText = useMemo(() => {
    const parts = [];
    if (op) parts.push(`${t("adm.oplog.f.op")}: ${L.op(op)}`);
    if (table) parts.push(`${t("adm.oplog.f.table")}: ${L.table(table)}`);
    if (actor) parts.push(`${t("adm.oplog.f.actor")}: ${data.facets.actors.find((a) => a.id === actor)?.label || actor}`);
    if (source) parts.push(`${t("adm.oplog.f.source")}: ${L.source(source)}`);
    if (q) parts.push(`«${q}»`);
    for (const [k, v] of Object.entries(col)) parts.push(t("adm.oplog.f.colSearch", { col: colLabel(k), text: v }));
    return parts.join(" · ");
  }, [op, table, actor, source, q, col, data.facets, L, t]);

  const doExport = useCallback(async (kind) => {
    if (exporting.current) return;
    exporting.current = true;
    try {
      const r = await adminFetch(`/admin/operation-log?${params({ export: 1, page: 1, limit: 5000 })}`);
      const rows = r.rows || [];
      const byOp = OPS.map((o) => ({ label: L.op(o), value: fmtInt(rows.filter((x) => x.op === o).length, lang) })).filter((p) => p.value !== "0");
      const tableCounts = new Map();
      const actorCounts = new Map();
      for (const x of rows) {
        tableCounts.set(x.table, (tableCounts.get(x.table) || 0) + 1);
        const a = L.actor(x);
        actorCounts.set(a, (actorCounts.get(a) || 0) + 1);
      }
      const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
      const truncated = r.total > rows.length;
      const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const spec = {
        lang, t, landscape: true,
        title: t("adm.oplog.x.title"),
        subtitle: t("adm.oplog.x.subtitle", { filters: [intervalText, storeObj ? `${storeObj.code} · ${storeObj.name}` : t("adm.oplog.x.allStores"), filtersText || t("adm.oplog.x.noFilters")].join(" · ") }),
        store: storeObj ? { code: storeObj.code, name: storeObj.name, color: storeObj.color, address: storeObj.address, phone: storeObj.phone } : null,
        period: { from: ymd(interval.from), to: ymd(interval.to) },
        generatedAt: new Date(),
        kpis: [
          { label: t("adm.oplog.kpi.total"), value: fmtInt(r.total, lang), raw: r.total },
          { label: t("adm.oplog.kpi.people"), value: fmtInt(actorCounts.size, lang), raw: actorCounts.size },
          { label: t("adm.oplog.kpi.tables"), value: fmtInt(tableCounts.size, lang), raw: tableCounts.size },
        ],
        summaries: [
          { title: t("adm.oplog.x.byOp"), pills: byOp },
          { title: t("adm.oplog.x.byTable"), pills: top(tableCounts, 6).map(([k, n]) => ({ label: L.table(k), value: fmtInt(n, lang) })) },
          { title: t("adm.oplog.x.byActor"), pills: top(actorCounts, 6).map(([k, n]) => ({ label: k, value: fmtInt(n, lang) })) },
        ].filter((s) => s.pills.length),
        tables: [{
          title: t("adm.oplog.x.table"),
          main: true,
          note: truncated ? t("adm.oplog.x.truncated", { n: fmtInt(rows.length, lang), total: fmtInt(r.total, lang) }) : undefined,
          cols: [
            { header: "#", key: "seq", width: 9 },
            { header: colLabel("at"), get: (x) => fmtAt(x.at, lang), width: 20 },
            { header: colLabel("actor"), get: (x) => L.actor(x), width: 24 },
            { header: colLabel("role"), get: (x) => L.role(x.role), width: 12 },
            { header: colLabel("op"), get: (x) => L.op(x.op), width: 14 },
            { header: colLabel("table"), get: (x) => L.table(x.table), width: 24 },
            { header: colLabel("changed"), get: (x) => x.summary || (x.changed || []).join(", "), width: 60 },
            { header: colLabel("store"), get: (x) => L.store(x), width: 8 },
            { header: colLabel("row"), key: "row_id", width: 30 },
            { header: colLabel("source"), get: (x) => L.source(x.source), width: 12 },
            { header: colLabel("route"), get: (x) => L.route(x), width: 36 },
            { header: colLabel("ip"), key: "ip", width: 14 },
            { header: colLabel("request"), key: "request_id", width: 36 },
          ],
          rows,
          empty: t("adm.oplog.empty"),
        }],
        filename: `registro-operaciones-${storeObj?.code || "todas"}-${ymd(interval.from)}_${ymd(interval.to)}`,
      };
      if (kind === "pdf") {
        // En papel apaisado caben nueve columnas legibles: el rol va con la persona y el origen con la ruta.
        const short = (v) => new Date(v).toLocaleString(locale(lang), { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
        spec.tables[0].cols = [
          { header: "#", key: "seq", width: 5 },
          { header: colLabel("at"), get: (x) => short(x.at), width: 13 },
          { header: colLabel("actor"), get: (x) => (x.role ? `${L.actor(x)} · ${L.role(x.role)}` : L.actor(x)), width: 18 },
          { header: colLabel("op"), get: (x) => L.op(x.op), width: 9 },
          { header: colLabel("table"), get: (x) => L.table(x.table), width: 15 },
          { header: colLabel("changed"), get: (x) => x.summary || (x.changed || []).join(", "), width: 40, cls: () => "wrap" },
          { header: colLabel("store"), get: (x) => L.store(x), width: 6 },
          { header: colLabel("route"), get: (x) => (x.route ? L.route(x) : L.source(x.source)), width: 22, cls: () => "wrap" },
          { header: colLabel("ip"), key: "ip", width: 10 },
        ];
      }
      exportReport(kind, spec, "owner");
    } catch {
      window.alert?.(t("adm.oplog.x.failed"));
    } finally {
      exporting.current = false;
    }
  }, [params, L, lang, t, storeObj, filtersText, interval, intervalText]);

  useRegisterExport(data.s === "ok" ? { pdf: () => doExport("pdf"), xlsx: () => doExport("xlsx"), csv: () => doExport("csv"), label: t("adm.oplog.x.label") } : null);

  const cell = (r, k) => {
    switch (k) {
      case "at": return <span className="ol-nowrap">{fmtAt(r.at, lang)}</span>;
      case "actor": return <span title={r.actor_email || ""}>{L.actor(r)}</span>;
      case "role": return L.role(r.role);
      case "op": return <span className={`adm-chip ${OP_TONE[r.op] || ""}`}>{L.op(r.op)}</span>;
      case "table": return <span className="ol-tbl"><b>{L.table(r.table)}</b>{L.table(r.table) !== r.table && <small>{r.table}</small>}</span>;
      case "changed": return <span className="ol-sum" title={r.summary}>{r.summary || (r.changed || []).join(", ") || "—"}</span>;
      case "store": return L.store(r);
      case "row": return <code className="ol-code">{r.row_id || "—"}</code>;
      case "source": return <span className={`ol-src ${r.source}`}>{L.source(r.source)}</span>;
      case "route": return <code className="ol-code" title={r.route || ""}>{L.route(r)}</code>;
      case "ip": return r.ip || "—";
      default: return null;
    }
  };

  return (
    <div className="adm-section ol-root">
      <div className="adm-head-row">
        <h2><Icon name="database" size={20} /> {t("adm.oplog.title")}</h2>
      </div>
      <p className="adm-sub">{t("adm.oplog.sub")}</p>
      <p className="ol-private"><Icon name="security" size={13} /> {t("adm.oplog.private")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.oplog.demo")}</div>}

      {!demo && (
        <>
          <div className="ol-kpis">
            <div><small>{t("adm.oplog.kpi.total")}</small><b>{fmtInt(data.total, lang)}</b></div>
            <div><small>{t("adm.oplog.kpi.people")}</small><b>{fmtInt(data.facets.actors.length, lang)}</b></div>
            <div><small>{t("adm.oplog.kpi.tables")}</small><b>{fmtInt(data.facets.tables.length, lang)}</b></div>
            <div className="wide"><small>{t("adm.oplog.kpi.interval")}</small><b className="ol-int">{intervalText}</b></div>
          </div>

          <div className="ol-filters">
            <label><span>{t("adm.oplog.hourFrom")}</span><input type="time" value={hourFrom} onChange={(e) => setHourFrom(e.target.value || "00:00")} /></label>
            <label><span>{t("adm.oplog.hourTo")}</span><input type="time" value={hourTo} onChange={(e) => setHourTo(e.target.value || "23:59")} /></label>
            <label><span>{t("adm.oplog.f.op")}</span>
              <select value={op} onChange={(e) => setOp(e.target.value)}>
                <option value="">{t("adm.oplog.f.all")}</option>
                {OPS.map((o) => <option key={o} value={o}>{L.op(o)}</option>)}
              </select>
            </label>
            <label><span>{t("adm.oplog.f.table")}</span>
              <select value={table} onChange={(e) => setTable(e.target.value)}>
                <option value="">{t("adm.oplog.f.all")}</option>
                {table && !data.facets.tables.some((x) => x.table === table) && <option value={table}>{L.table(table)}</option>}
                {data.facets.tables.map((x) => <option key={x.table} value={x.table}>{L.table(x.table)} ({fmtInt(x.n, lang)})</option>)}
              </select>
            </label>
            <label><span>{t("adm.oplog.f.actor")}</span>
              <select value={actor} onChange={(e) => setActor(e.target.value)}>
                <option value="">{t("adm.oplog.f.all")}</option>
                {actor && !data.facets.actors.some((x) => x.id === actor) && <option value={actor}>{actor}</option>}
                {data.facets.actors.map((x) => <option key={x.id} value={x.id}>{x.label} ({fmtInt(x.n, lang)})</option>)}
              </select>
            </label>
            <label><span>{t("adm.oplog.f.source")}</span>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">{t("adm.oplog.f.all")}</option>
                {SOURCES.map((s) => <option key={s} value={s}>{L.source(s)}</option>)}
              </select>
            </label>
            <label className="grow"><span className="sr-only">{t("adm.oplog.f.q")}</span>
              <span className="ol-q"><Icon name="search" size={14} /><input type="search" value={qText} maxLength={120} placeholder={t("adm.oplog.f.q")} onChange={(e) => setQText(e.target.value)} /></span>
            </label>
            {anyFilter ? <button type="button" className="btn btn-xs" onClick={clearAll}><Icon name="close" size={12} /> {t("adm.oplog.f.clear")}</button> : null}
          </div>

          {Object.keys(col).length > 0 && (
            <div className="ol-chips">
              {Object.entries(col).map(([k, v]) => (
                <span key={k} className="adm-chip">
                  {t("adm.oplog.f.colSearch", { col: colLabel(k), text: v })}
                  <button type="button" onClick={() => onSearch(k, "")} aria-label={t("adm.oplog.f.removeSearch")} title={t("adm.oplog.f.removeSearch")}>×</button>
                </span>
              ))}
            </div>
          )}

          {data.s === "error" && (
            <div className="adm-demo-banner">{t("adm.oplog.loadFailed")} <button type="button" className="btn btn-xs" onClick={() => setReload((n) => n + 1)}>{t("adm.oplog.retry")}</button></div>
          )}

          <div className={`adm-table-wrap ol-wrap ${data.s === "loading" ? "is-loading" : ""}`}>
            <table className="adm-table ol-table">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <OpTh key={c.key} col={c.key} w={c.w} label={colLabel(c.key)} sort={sort} onSort={onSort} search={col[c.key]} onSearch={onSearch} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.seq} className={`ol-row op-${r.op}`} tabIndex={0} onClick={() => setOpen(r.seq)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(r.seq); }} title={t("adm.oplog.open")}>
                    {COLS.map((c) => <td key={c.key} className={`c-${c.key}`}>{cell(r, c.key)}</td>)}
                  </tr>
                ))}
                {data.s === "ok" && data.rows.length === 0 && (
                  <tr><td colSpan={COLS.length} className="ol-empty"><Icon name="database" size={28} /><b>{t("adm.oplog.empty")}</b></td></tr>
                )}
              </tbody>
            </table>
            {data.s === "loading" && <div className="ol-loading">{t("adm.oplog.loading")}</div>}
          </div>

          <div className="ol-pager">
            <span>{t("adm.oplog.shown", { from: fmtInt(data.total ? (page - 1) * limit + 1 : 0, lang), to: fmtInt(Math.min(data.total, page * limit), lang), total: fmtInt(data.total, lang) })}</span>
            <span className="ol-pager-nav">
              <button type="button" className="btn btn-xs" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ {t("adm.oplog.prev")}</button>
              <b>{t("adm.oplog.page", { page: fmtInt(page, lang), pages: fmtInt(pages, lang) })}</b>
              <button type="button" className="btn btn-xs" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>{t("adm.oplog.next")} ›</button>
            </span>
            <label>
              <span>{t("adm.oplog.perPage")}</span>
              <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </>
      )}
      {open && <OpDetail seq={open} onClose={() => setOpen(null)} onOpen={setOpen} />}
    </div>
  );
}
