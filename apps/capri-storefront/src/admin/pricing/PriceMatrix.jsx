// Dónde se usa: «Productos y precios» (PricingPanel.jsx, pestaña `products`),
// subpestañas Monturas · Estuches · Lentes · Tratamientos. Contrato:
// docs/PRICE-MATRIX.md.
//
// Lo que pidió el dueño, tal cual: UNA tabla, agrupada en acordeón por marca
// (diseño de lente, familia de tratamiento); cada fila es un artículo; la
// primera columna es el costo (el de Capri, editable) y luego una columna por
// tienda, con el color de la tienda, con su precio de venta y al lado el
// descuento % de ESE artículo en ESA tienda. Sencillo y sin espacio perdido.
//
// Decisiones de interfaz:
// - Celda = número que se escribe y se guarda al salir (o con Enter, que baja a
//   la misma columna de la fila siguiente, como en una hoja). Esc deshace.
// - El precio que se ve es el EFECTIVO (lo que cobra la caja). Un precio fijado
//   en esa tienda va en negrita con un punto y una «×» para volver a la regla;
//   el porqué de cualquier otro precio (regla / banda / maestro) está en el
//   globo de la celda, junto al margen.
// - El descuento enseña debajo el precio final cuando hay descuento.
// - El ojo de cada celda de montura es el surtido de la tienda (expone / oculta
//   ese modelo) y el interruptor de la cabecera del acordeón el de la marca:
//   lo que antes estaba en la pestaña «Productos».
// - Solo se pintan los grupos abiertos (cientos de modelos × tiendas × 2
//   casillas); al buscar o filtrar se abren solos los grupos con resultados.
// - Sin permiso de costos (`cost_access` false) la columna de costo no existe.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { useFeedback } from "../../components/Feedback.jsx";
import { money } from "../adminOrders.js";
import { setAssortmentRule } from "../adminStores.js";
import { setProductStatus } from "../catalogAdmin.js";
import { NEW_MODEL_DAYS } from "../catalogSync.js";
import { buildStyledXlsx, downloadBytes, readXlsx } from "../exportXlsx.js";
import { useRegisterExport } from "../GlobalFilterBar.jsx";
import Icon from "../icons.jsx";
import { fetchMatrix, importMatrix, saveMatrixCell } from "./api.js";
import NumCell from "./matrix/NumCell.jsx";
import AddFrameDialog from "./matrix/AddFrameDialog.jsx";
import AddTreatmentDialog from "./matrix/AddTreatmentDialog.jsx";
import ImportDialog from "./matrix/ImportDialog.jsx";
import {
  MATRIX_SECTIONS, filterGroups, finalCents, groupLabel, groupStats, marginOf, patchCell, patchSiblingCost, replaceRow, rowKind, rowTitle, slugify, sourceKey, usd,
} from "./matrix/model.js";
import { matrixWorkbook, workbookToImport } from "./matrix/matrixXlsx.js";
import "./price-matrix.css";

const OPEN_KEY = (section) => `adm_pm_open_${section}`;
const readOpen = (section) => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY(section)) || "null");
    return Array.isArray(v) ? new Set(v) : null;
  } catch {
    return null;
  }
};
const writeOpen = (section, set) => {
  try { localStorage.setItem(OPEN_KEY(section), JSON.stringify([...set])); } catch { /* sin almacenamiento: solo no se recuerda */ }
};

const FILTERS = ["nocost", "discount", "exact"];
/** «Nuevo» while the scraper's `first_seen_at` is recent (optional field of the row). */
const isNewModel = (r) => {
  const ts = r?.first_seen_at ? Date.parse(r.first_seen_at) : NaN;
  return Number.isFinite(ts) && Date.now() - ts < NEW_MODEL_DAYS * 864e5;
};
const pctText = (v) => (v == null ? "—" : `${Math.round(v)} %`);

/** Search box with its own debounce: typing never re-renders the whole matrix per key. */
function SearchBox({ value, onChange, placeholder }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return undefined;
    const id = setTimeout(() => onChange(text), 220);
    return () => clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="pm-search">
      <Icon name="search" size={14} />
      <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export default function PriceMatrix({ section, me = null, onlyStore = null, initialQ = "" }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [state, setState] = useState("loading");
  const [q, setQ] = useState(initialQ || "");
  const [filters, setFilters] = useState(() => new Set());
  const [open, setOpen] = useState(() => readOpen(section));
  const [dialog, setDialog] = useState(null); // { type: "frame"|"case"|"brand"|"treatment" }
  const [busy, setBusy] = useState(""); // "export" | "import" | `brand:<g>:<s>` | `clear:<row>:<s>` | `eye:<row>:<s>`
  const [imp, setImp] = useState(null);
  const [impBusy, setImpBusy] = useState(false);
  const [flash, setFlash] = useState(null); // row key just created
  const tableRef = useRef(null);
  const fileRef = useRef(null);

  const isFrames = section === "frames" || section === "cases";
  const truncated = Boolean(data?.truncated);
  const serverQ = truncated && q.trim().length >= 2 ? q.trim() : "";

  const load = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    try {
      const d = await fetchMatrix(section, { q: serverQ });
      setData(d);
      setGroups(Array.isArray(d?.groups) ? d.groups : []);
      setState("ok");
      return d;
    } catch (e) {
      if (!silent) setState(e.message || "adm.err.pricing.load_failed");
      else toast({ tone: "error", title: t(e.message || "adm.err.pricing.load_failed") });
      return null;
    }
  }, [section, serverQ]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const allStores = useMemo(() => (Array.isArray(data?.stores) ? data.stores : []), [data]);
  // The global store picker narrows the columns to ONE store (handy on a phone);
  // «Todas las tiendas» / «Tienda online» shows them all.
  const stores = useMemo(() => {
    const one = onlyStore ? allStores.filter((s) => s.id === onlyStore) : [];
    return one.length ? one : allStores;
  }, [allStores, onlyStore]);
  const storeIds = useMemo(() => stores.map((s) => s.id), [stores]);
  const costAccess = Boolean(data?.cost_access);

  // Default: the first group open the first time a section is seen.
  const openSet = useMemo(() => open || new Set(groups.length ? [groups[0].key] : []), [open, groups]);
  const searching = q.trim().length > 0 || filters.size > 0;
  const shown = useMemo(() => filterGroups(groups, { q, filters, storeIds }), [groups, q, filters, storeIds]);
  const isOpen = (g) => searching || openSet.has(g.key);
  const toggleGroup = (key) => {
    const next = new Set(openSet);
    if (next.has(key)) next.delete(key); else next.add(key);
    setOpen(next);
    writeOpen(section, next);
  };
  const allOpen = groups.length > 0 && groups.every((g) => openSet.has(g.key));
  const toggleAll = () => {
    const next = allOpen ? new Set() : new Set(groups.map((g) => g.key));
    setOpen(next);
    writeOpen(section, next);
  };

  const counts = useMemo(() => {
    const c = { rows: 0, nocost: 0, discount: 0, exact: 0 };
    for (const g of groups) for (const r of g.rows || []) {
      c.rows += 1;
      if (!(Number(r.cost_cents) > 0) && r.available !== false) c.nocost += 1;
      const cells = storeIds.map((id) => r.stores?.[id]).filter(Boolean);
      if (cells.some((x) => Number(x.discount_pct) > 0)) c.discount += 1;
      if (cells.some((x) => x.exact || x.source === "store_exact")) c.exact += 1;
    }
    return c;
  }, [groups, storeIds]);

  const toggleFilter = (f) => setFilters((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  /* ───────────── Writes ───────────── */

  const save = useCallback(async (row, field, storeId, value) => {
    const kind = rowKind(row, section);
    const res = await saveMatrixCell({ kind, key: row.key, field, store: storeId, value });
    if (res?.row) {
      setGroups((g) => {
        let next = replaceRow(g, res.row);
        // A photochromic has ONE cost per option, shown on each of its category
        // rows (`code:sv`, `code:bifocal`, `code:prog`): the siblings take it too.
        if (kind === "photo" && field === "cost") next = patchSiblingCost(next, res.row);
        return next;
      });
    } else load(true);
  }, [section, load]);

  const clearExact = async (row, store) => {
    const k = `clear:${row.key}:${store.id}`;
    if (busy) return;
    setBusy(k);
    try {
      await save(row, "price", store.id, null);
      toast({ tone: "success", title: t("adm.pm.clearedToRule", { store: store.code }) });
    } catch (e) {
      toast({ tone: "error", title: t(e.message || "adm.err.pricing.save_failed") });
    } finally {
      setBusy("");
    }
  };

  const toggleExposure = async (row, store) => {
    const k = `eye:${row.key}:${store.id}`;
    if (busy) return;
    const next = row.stores?.[store.id]?.exposed === false;
    setBusy(k);
    setGroups((g) => patchCell(g, row.key, store.id, { exposed: next }));
    try {
      await setAssortmentRule(store.id, { scope: "product", target: row.product_id || row.key, exposed: next });
    } catch (e) {
      setGroups((g) => patchCell(g, row.key, store.id, { exposed: !next }));
      toast({ tone: "error", title: t(e.message || "adm.err.assortment.saveFailed") });
    } finally {
      setBusy("");
    }
  };

  const toggleBrand = async (group, store, visible) => {
    const k = `brand:${group.key}:${store.id}`;
    if (busy) return;
    setBusy(k);
    try {
      await setAssortmentRule(store.id, { scope: "brand", target: group.key, exposed: !visible });
      // Model rules win over the brand rule: the server says what is exposed now.
      await load(true);
      toast({ tone: "success", title: t(visible ? "adm.pm.brandHidden" : "adm.pm.brandShown", { brand: group.label, store: store.code }) });
    } catch (e) {
      toast({ tone: "error", title: t(e.message || "adm.err.assortment.saveFailed") });
    } finally {
      setBusy("");
    }
  };

  const toggleStatus = async (row) => {
    const discontinue = (row.status || "published") === "published";
    if (discontinue && !(await confirm({ tone: "danger", title: t("adm.pm.discontinueQ", { name: row.title }), message: t("adm.pm.discontinueMsg") }))) return;
    try {
      await setProductStatus(row.product_id || row.key, discontinue);
      setGroups((g) => patchCell(g, row.key, null, { status: discontinue ? "draft" : "published" }));
      toast({ tone: "success", title: t(discontinue ? "adm.pm.discontinued" : "adm.pm.reactivated", { name: row.title }) });
    } catch {
      toast({ tone: "error", title: t("adm.pm.statusFailed") });
    }
  };

  /* ───────────── Keyboard: Enter goes down the same column ───────────── */
  const onNav = useCallback((el, col, dir) => {
    const root = tableRef.current;
    if (!root || !el) return;
    const list = [...root.querySelectorAll("input.pm-in")].filter((x) => x.dataset.col === col);
    const next = list[list.indexOf(el) + dir];
    if (next) { next.focus(); next.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }, []);

  /* ───────────── Excel ───────────── */
  const who = me?.display_name || me?.email || "";
  const fmtDate = (d) => d.toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" });

  const loadAll = async () => {
    const out = {};
    await Promise.all(MATRIX_SECTIONS.map(async (s) => {
      out[s] = s === section && data && !serverQ ? { ...data, groups } : await fetchMatrix(s);
    }));
    return out;
  };

  const exportExcel = async () => {
    if (busy || !data) return;
    setBusy("export");
    try {
      const sections = await loadAll();
      const now = new Date();
      const sheets = matrixWorkbook({ sections, stores: allStores, costAccess, who, now, t, fmtDate, lang });
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      downloadBytes(`${t("adm.pm.xlsx.file")}-${stamp}.xlsx`, buildStyledXlsx(sheets));
      toast({ tone: "success", title: t("adm.pm.exported") });
    } catch (e) {
      toast({ tone: "error", title: t(String(e?.message || "").startsWith("adm.") ? e.message : "adm.pm.exportFailed") });
    } finally {
      setBusy("");
    }
  };

  // The bar's Excel button (GlobalFilterBar) gives the same professional workbook.
  const exportRef = useRef(exportExcel);
  exportRef.current = exportExcel;
  useRegisterExport(data ? { xlsx: () => exportRef.current(), label: t("adm.pm.export") } : null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    setBusy("import");
    try {
      let read;
      try { read = await readXlsx(new Uint8Array(await file.arrayBuffer())); } catch { throw new Error("adm.pm.imp.readFailed"); }
      const current = await loadAll();
      const local = workbookToImport(read, { current, stores: allStores });
      if (!local.sheets) throw new Error("adm.pm.imp.notOurs");
      // A store code this account does not have is an ERROR, not a note: its
      // columns cannot be applied, and applying the rest would leave the book
      // half in. It also must not end as «no changes» when it is all there is.
      const storeErrors = (local.unknownStoreSheets || []).map((u) => ({ row: 2, reason: "store_not_found", detail: `${u.sheet} · ${u.code}` }));
      if (!local.rows.length && !local.problems.length && !storeErrors.length) {
        toast({ tone: "info", title: t("adm.pm.imp.noChanges", { n: local.unchanged }) });
        return;
      }
      const res = local.rows.length ? await importMatrix(local.rows, false) : { plan: { changes: [], errors: [] } };
      const plan = res?.plan || res || {};
      // The server numbers the rows of the request; the owner reads the sheet's.
      const at = (i) => (local.origins || [])[i] || null;
      const errors = [
        ...storeErrors,
        ...local.problems.map((p) => ({ row: p.row, reason: p.reason, detail: p.sheet })),
        ...(plan.errors || []).map((e) => {
          const o = at(e.row);
          return o ? { ...e, row: o.row, detail: [o.sheet, e.detail].filter(Boolean).join(" · ") } : e;
        }),
      ];
      setImp({ file: file.name, local, rows: local.rows, plan: { ...plan, changes: plan.changes || [], errors } });
    } catch (err) {
      toast({ tone: "error", title: t(String(err?.message || "").startsWith("adm.") ? err.message : "adm.pm.imp.readFailed") });
    } finally {
      setBusy("");
    }
  };

  const applyImport = async () => {
    if (!imp || impBusy) return;
    setImpBusy(true);
    try {
      const r = await importMatrix(imp.rows, true);
      toast({ tone: "success", title: t("adm.pm.imp.applied", { n: r?.applied ?? imp.plan.changes.length }) });
      setImp(null);
      load(true);
    } catch (err) {
      toast({ tone: "error", title: t(err.message || "adm.err.pricing.save_failed") });
    } finally {
      setImpBusy(false);
    }
  };

  /* ───────────── After an add dialog ───────────── */
  const afterCreate = async ({ groupKey, sku, label }) => {
    setDialog(null);
    toast({ tone: "success", title: t("adm.pm.created", { name: label }) });
    const d = await load(true);
    const list = d?.groups || [];
    const g = list.find((x) => (sku && x.rows?.some((r) => r.sku === sku)) || x.key === groupKey)
      || (section === "treatments" ? list.find((x) => String(x.key).startsWith(groupKey)) : null) || null;
    if (g) {
      const next = new Set(openSet);
      next.add(g.key);
      setOpen(next);
      writeOpen(section, next);
      const row = sku ? g.rows.find((r) => r.sku === sku) : g.rows[g.rows.length - 1];
      if (row) setFlash(row.key);
    }
  };
  useEffect(() => {
    if (!flash) return undefined;
    // Scroll inside the matrix only: scrolling the page would push the sticky header out of view.
    const box = tableRef.current;
    const el = box?.querySelector(`tr[data-key="${CSS.escape(flash)}"]`);
    if (box && el) box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight / 2), behavior: "smooth" });
    const id = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(id);
  }, [flash, groups]);

  /* ───────────── Render ───────────── */
  if (state === "loading") return <div className="adm-src-note loading">{t("adm.pm.loading")}</div>;
  if (state !== "ok" || !data) {
    return (
      <div className="pm-empty">
        <div className="adm-login-err">{t(state === "ok" ? "adm.err.pricing.load_failed" : state)}</div>
        <button type="button" className="btn-xs" onClick={() => load()}>{t("adm.pm.retry")}</button>
      </div>
    );
  }

  const fixedCols = costAccess ? 2 : 1;
  const addLabel = section === "cases" ? "adm.pm.addCase" : "adm.pm.addFrame";

  return (
    <div className="pm" data-section={section}>
      <div className="pm-bar adm-noprint">
        <SearchBox value={q} onChange={setQ} placeholder={t(isFrames ? "adm.pm.searchFrames" : "adm.pm.search")} />
        <div className="pm-chips" role="group" aria-label={t("adm.pm.filters")}>
          {FILTERS.filter((f) => f !== "nocost" || costAccess).map((f) => (
            <button key={f} type="button" className={filters.has(f) ? "on" : ""} aria-pressed={filters.has(f)} onClick={() => toggleFilter(f)}>
              {t(`adm.pm.filter.${f}`)} <small>{counts[f]}</small>
            </button>
          ))}
        </div>
        <button type="button" className="btn-xs pm-ico" onClick={toggleAll} disabled={searching} title={t(allOpen ? "adm.pm.collapseAll" : "adm.pm.expandAll")} aria-label={t(allOpen ? "adm.pm.collapseAll" : "adm.pm.expandAll")}>
          <Icon name={allOpen ? "chevronUp" : "chevronDown"} size={14} />
        </button>
        <span className="pm-bar-gap" />
        {isFrames && (
          <>
            <button type="button" className="btn-xs" onClick={() => setDialog({ type: "brand" })} title={t("adm.pm.addBrand")}><Icon name="plus" size={13} /> <span className="pm-bl">{t("adm.pm.addBrand")}</span></button>
            <button type="button" className="btn-xs primary" onClick={() => setDialog({ type: section === "cases" ? "case" : "frame" })}><Icon name="plus" size={13} /> {t(addLabel)}</button>
          </>
        )}
        {section === "treatments" && (
          <button type="button" className="btn-xs primary" onClick={() => setDialog({ type: "treatment" })}><Icon name="plus" size={13} /> {t("adm.pm.addTreatment")}</button>
        )}
        <button type="button" className="btn-xs" onClick={exportExcel} disabled={Boolean(busy)} title={t("adm.pm.exportHint")} aria-label={t("adm.pm.export")}>
          <Icon name="download" size={13} /> <span className="pm-bl">{busy === "export" ? t("adm.pm.working") : t("adm.pm.exportShort")}</span>
        </button>
        <button type="button" className="btn-xs" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)} title={t("adm.pm.importHint")} aria-label={t("adm.pm.import")}>
          <Icon name="upload" size={13} /> <span className="pm-bl">{busy === "import" ? t("adm.pm.working") : t("adm.pm.importShort")}</span>
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={onFile} />
      </div>

      {truncated && <p className="pm-note"><Icon name="info" size={12} /> {t("adm.pm.truncated")}</p>}

      <div className="pm-card">
        <div className="pm-scroll" ref={tableRef}>
          <table className={`pm-table ${costAccess ? "has-cost" : ""}`} style={{ "--pm-n": stores.length }}>
            <colgroup>
              <col className="pm-w-art" />
              {costAccess && <col className="pm-w-cost" />}
              {stores.map((s) => <Fragment key={s.id}><col className="pm-w-price" /><col className="pm-w-disc" /></Fragment>)}
            </colgroup>
            <thead>
              <tr className="pm-h1">
                <th rowSpan={2} className="pm-c-art pm-corner" scope="col">
                  {t("adm.pm.col.item")} <small>{counts.rows}</small>
                </th>
                {costAccess && <th rowSpan={2} className="pm-c-cost pm-corner" scope="col">{t("adm.pm.col.cost")}</th>}
                {stores.map((s) => (
                  <th key={s.id} colSpan={2} scope="colgroup" className="pm-store" style={{ "--st": s.color || "var(--adm-accent)" }} title={`${s.code} · ${s.name}`}>
                    <span className="pm-store-n"><b>{s.code}</b> {s.name}</span>
                  </th>
                ))}
              </tr>
              <tr className="pm-h2">
                {stores.map((s) => (
                  <Fragment key={s.id}>
                    <th scope="col" className="pm-sub pm-c-price" style={{ "--st": s.color || "var(--adm-accent)" }}>{t("adm.pm.col.price")}</th>
                    <th scope="col" className="pm-sub pm-c-disc" style={{ "--st": s.color || "var(--adm-accent)" }}>{t("adm.pm.col.discount")}</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            {shown.length === 0 && (
              <tbody>
                <tr><td className="pm-none" colSpan={fixedCols + stores.length * 2}>{t(searching ? "adm.pm.noMatch" : "adm.pm.emptySection")}</td></tr>
              </tbody>
            )}
            {shown.map((g) => {
              const stats = groupStats(g, storeIds);
              const expanded = isOpen(g);
              // Only a real brand group carries `stores` (its switch writes a brand rule).
              const brandLike = isFrames && g.kind === "brand" && Boolean(g.stores);
              return (
                <tbody key={g.key} className={`pm-grp ${expanded ? "open" : ""}`}>
                  <tr className="pm-gh">
                    <th colSpan={fixedCols} className="pm-c-art pm-gh-name" scope="rowgroup">
                      <div className="pm-gh-in">
                      <button type="button" className="pm-gh-btn" aria-expanded={expanded} onClick={() => toggleGroup(g.key)} disabled={searching}>
                        <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />
                        <b>{groupLabel(g, t, lang)}</b>
                        <span className="pm-gh-n">{stats.count}</span>
                      </button>
                      <span className="pm-gh-stats">
                        {costAccess && stats.avgCostCents != null && <span title={t("adm.pm.avgCost")}>{t("adm.pm.avgCostShort")} {money(usd(stats.avgCostCents), "usd", lang)}</span>}
                        {stats.avgMargin != null && <span className={stats.avgMargin < 30 ? "low" : ""} title={t("adm.pm.avgMargin")}>{t("adm.pm.marginShort")} {pctText(stats.avgMargin)}</span>}
                      </span>
                      </div>
                    </th>
                    {stores.map((s) => {
                      const ps = stats.perStore[s.id] || {};
                      const k = `brand:${g.key}:${s.id}`;
                      return (
                        <td key={s.id} colSpan={2} className="pm-gh-store" style={{ "--st": s.color || "var(--adm-accent)" }}>
                          <span className="pm-gh-cell">
                          {brandLike && (
                            <label className="pm-sw" title={t(ps.visible ? "adm.pm.brandVisibleHint" : "adm.pm.brandHiddenHint", { store: s.code })}>
                              <input
                                type="checkbox"
                                role="switch"
                                checked={Boolean(ps.visible)}
                                disabled={busy === k}
                                onChange={() => toggleBrand(g, s, ps.visible)}
                                aria-label={t("adm.pm.brandVisibleAria", { brand: g.label, store: s.code })}
                              />
                              <span>{t("adm.pm.visible")}</span>
                            </label>
                          )}
                          {ps.margin != null && <span className={`pm-gh-m ${ps.margin < 30 ? "low" : ""}`} title={t("adm.pm.storeMargin", { store: s.code })}>{t("adm.pm.marginShort")} {pctText(ps.margin)}</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                  {expanded && g.rows.map((r) => (
                    <tr key={r.key} data-key={r.key} className={`pm-row ${r.status && r.status !== "published" ? "is-draft" : ""} ${flash === r.key ? "is-new" : ""}`}>
                      <th scope="row" className="pm-c-art">
                        <span className="pm-art">
                          {isFrames && (
                            <span className="pm-thumb" aria-hidden="true">
                              {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" width="28" height="28" /> : <Icon name={section === "cases" ? "box" : "glasses"} size={14} />}
                            </span>
                          )}
                          <span className="pm-art-t">
                            <b title={rowTitle(r, t, lang)}>{rowTitle(r, t, lang)}</b>
                            <small>
                              {r.sku && r.sku !== r.title ? r.sku : section === "lenses" || section === "treatments" ? r.key : ""}
                              {r.status && r.status !== "published" && <em className="pm-draft">{t("adm.pm.draft")}</em>}
                              {isNewModel(r) && <em className="pm-new">{t("adm.pm.new")}</em>}
                              {r.available === false && <em className="pm-draft" title={t("adm.pm.digitalOffHint")}>{t("adm.pm.digitalOff")}</em>}
                            </small>
                          </span>
                          {isFrames && r.product_id && (
                            <button
                              type="button"
                              className={`pm-act ${r.status && r.status !== "published" ? "on" : ""}`}
                              tabIndex={-1}
                              onClick={() => toggleStatus(r)}
                              title={t(r.status && r.status !== "published" ? "adm.pm.reactivate" : "adm.pm.discontinue")}
                              aria-label={t(r.status && r.status !== "published" ? "adm.pm.reactivate" : "adm.pm.discontinue")}
                            >
                              <Icon name="power" size={12} />
                            </button>
                          )}
                        </span>
                      </th>
                      {costAccess && (
                        <td className="pm-c-cost">
                          <NumCell
                            field="cost"
                            col="cost"
                            value={usd(r.cost_cents)}
                            onCommit={(v) => save(r, "cost", null, v)}
                            onNav={onNav}
                            disabled={r.available === false}
                            className={r.cost_source === "owner_edit" ? "own" : r.available === false ? "" : !(Number(r.cost_cents) > 0) ? "missing" : ""}
                            placeholder={r.available === false ? "—" : t("adm.pm.noCost")}
                            label={t("adm.pm.cellCost", { item: rowTitle(r, t, lang) })}
                            title={t(r.available === false ? "adm.pm.digitalOffCost" : r.cost_source === "owner_edit" ? "adm.pm.costOwn" : r.cost_cents > 0 ? "adm.pm.costList" : "adm.pm.costMissing")}
                          />
                        </td>
                      )}
                      {stores.map((s) => {
                        const cell = r.stores?.[s.id] || {};
                        const exact = Boolean(cell.exact || cell.source === "store_exact");
                        const pct = Number(cell.discount_pct) || 0;
                        const fin = finalCents(cell);
                        const hidden = isFrames && cell.exposed === false;
                        const margin = costAccess ? marginOf(fin, r.cost_cents) : null;
                        const tip = r.available === false ? t("adm.pm.digitalOffHint") : [t(sourceKey(cell.source)), margin != null ? t("adm.pm.marginTip", { v: margin }) : null, hidden ? t("adm.pm.hiddenTip") : null].filter(Boolean).join(" · ");
                        const clearing = busy === `clear:${r.key}:${s.id}`;
                        return (
                          <Fragment key={s.id}>
                            <td className={`pm-c-price ${hidden ? "is-hidden" : ""}`} style={{ "--st": s.color || "var(--adm-accent)" }}>
                              <NumCell
                                field="price"
                                col={`p:${s.id}`}
                                value={usd(cell.price_cents)}
                                onCommit={(v) => save(r, "price", s.id, v)}
                                onNav={onNav}
                                className={`${exact ? "exact" : ""} ${isFrames ? "has-eye" : ""} ${exact ? "has-x" : ""} ${clearing ? "is-saving" : ""}`}
                                placeholder="—"
                                label={t("adm.pm.cellPrice", { store: s.code })}
                                title={tip}
                              >
                                {isFrames && (
                                  <button
                                    type="button"
                                    className={`pm-eye ${hidden ? "off" : ""}`}
                                    tabIndex={-1}
                                    disabled={busy === `eye:${r.key}:${s.id}`}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => toggleExposure(r, s)}
                                    title={t(hidden ? "adm.pm.showIn" : "adm.pm.hideIn", { store: s.code })}
                                    aria-label={t(hidden ? "adm.pm.showIn" : "adm.pm.hideIn", { store: s.code })}
                                    aria-pressed={!hidden}
                                  >
                                    <Icon name="eye" size={12} />
                                  </button>
                                )}
                                {exact && (
                                  <button
                                    type="button"
                                    className="pm-x"
                                    tabIndex={-1}
                                    disabled={clearing}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => clearExact(r, s)}
                                    title={t("adm.pm.clearExact")}
                                    aria-label={t("adm.pm.clearExact")}
                                  >
                                    <Icon name="close" size={10} strokeWidth={2.6} />
                                  </button>
                                )}
                              </NumCell>
                            </td>
                            <td className={`pm-c-disc ${hidden ? "is-hidden" : ""}`}>
                              <NumCell
                                field="discount"
                                col={`d:${s.id}`}
                                value={pct > 0 ? pct : null}
                                onCommit={(v) => save(r, "discount", s.id, v)}
                                onNav={onNav}
                                className={pct > 0 ? "has-disc" : ""}
                                placeholder="—"
                                label={t("adm.pm.cellDiscount", { store: s.code })}
                                title={pct > 0 && fin != null ? t("adm.pm.finalTip", { price: money(usd(fin), "usd", lang) }) : t("adm.pm.discountTip")}
                                sub={pct > 0 && fin != null ? money(usd(fin), "usd", lang) : null}
                              />
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>

      <p className="pm-legend adm-noprint">
        <span><i className="pm-lg-exact" /> {t("adm.pm.legend.exact")}</span>
        {isFrames && <span><Icon name="eye" size={11} /> {t("adm.pm.legend.eye")}</span>}
        <span><Icon name="arrowRight" size={11} /> {t("adm.pm.legend.keys")}</span>
      </p>

      {dialog && (dialog.type === "frame" || dialog.type === "case" || dialog.type === "brand") && (
        <AddFrameDialog
          kind={dialog.type === "brand" ? (section === "cases" ? "case" : "frame") : dialog.type}
          newBrand={dialog.type === "brand"}
          stores={allStores}
          groups={groups}
          costAccess={costAccess}
          onClose={() => setDialog(null)}
          onCreated={(res, body) => afterCreate({ groupKey: body.brand_slug || slugify(body.brand), sku: res?.product?.sku || body.sku, label: `${body.brand} ${body.model}` })}
        />
      )}
      {dialog?.type === "treatment" && (
        <AddTreatmentDialog
          costAccess={costAccess}
          onClose={() => setDialog(null)}
          onCreated={(res, body) => afterCreate({ groupKey: body.type === "photo" ? "photo" : "ar", sku: null, label: lang === "en" ? body.label_en : body.label_es })}
        />
      )}
      {imp && (
        <ImportDialog
          file={imp.file}
          local={imp.local}
          plan={imp.plan}
          stores={allStores}
          busy={impBusy}
          onApply={applyImport}
          onClose={() => setImp(null)}
        />
      )}
    </div>
  );
}
