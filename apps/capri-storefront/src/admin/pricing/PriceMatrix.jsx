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
//
// v2 (7-nov-2026, docs/PRICE-MATRIX.md «v2»), tras verlo el dueño en staging:
// - Cabecera de marca con su LOGO (registro `catalog_brand`; sin logo, un
//   monograma de color), modelos, costo y margen promedio y, en las MISMAS
//   columnas de cada tienda: el interruptor «Visible», el PRECIO DE MARCA (todos
//   los modelos de la marca a ese precio en esa tienda) y el DESC % DE MARCA,
//   casillas como las de las filas (`kind: "brand"`). Precedencia: precio del
//   modelo > de la marca > regla > banda > maestro; la fila dice de dónde sale
//   con una píldora de color (exacto · marca · regla · banda · maestro) y el
//   costo la suya (Capri 2026 · lista anterior · editado).
// - Miniatura de 40 px en cada modelo; si no carga, un marco neutro.
// - Menú ⋯ en la cabecera (añadir modelo, editar y borrar la marca) y en cada
//   fila (editar, descontinuar, borrar el modelo; editar y borrar un
//   tratamiento). Alta/edición de marca con logo y de modelo con la ficha
//   completa de la tienda online (matrix/BrandDialog.jsx, FrameDialog.jsx).
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
import {
  deleteCatalogBrand, deleteCatalogFrame, deleteTreatment, fetchCatalogBrands, fetchMatrix, importMatrix, saveMatrixCell, updateCatalogBrand, wasArchived,
} from "./api.js";
import NumCell from "./matrix/NumCell.jsx";
import BrandDialog, { knownErr } from "./matrix/BrandDialog.jsx";
import FrameDialog from "./matrix/FrameDialog.jsx";
import TreatmentDialog from "./matrix/TreatmentDialog.jsx";
import ImportDialog from "./matrix/ImportDialog.jsx";
import MoreMenu from "./matrix/MoreMenu.jsx";
import { BrandLogo, Thumb } from "./matrix/Media.jsx";
import {
  MATRIX_SECTIONS, brandCell, brandOff, brandScope, costTone, orderOff, rowHiddenSome, groupOff, filterGroups, finalCents, groupLabel, groupStats, isBrandGroup, marginOf,
  patchCell, removeRow, replaceGroup, replaceRow, rowKind, rowTitle, slugify, sourceKey, sourceTone, treatmentCode, usd, withRegistry,
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

const FILTERS = ["nocost", "discount", "exact", "off"];
/** «Nuevo» while the scraper's `first_seen_at` is recent (optional field of the row). */
const isNewModel = (r) => {
  const ts = r?.first_seen_at ? Date.parse(r.first_seen_at) : NaN;
  return Number.isFinite(ts) && Date.now() - ts < NEW_MODEL_DAYS * 864e5;
};
const pctText = (v) => (v == null ? "—" : `${Math.round(v)} %`);
const isExact = (cell) => Boolean(cell?.exact || cell?.source === "store_exact");

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

/** Small coloured pill under a price (source) or a cost (where it comes from). */
const Pill = ({ tone, children }) => <i className={`pm-pill t-${tone}`}>{children}</i>;

export default function PriceMatrix({ section, me = null, onlyStore = null, initialQ = "" }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [brands, setBrands] = useState(null); // registry (frames/cases only)
  const [state, setState] = useState("loading");
  const [q, setQ] = useState(initialQ || "");
  const [filters, setFilters] = useState(() => new Set());
  const [open, setOpen] = useState(() => readOpen(section));
  // { type: "brand", brand? } | { type: "frame", kind, row?, presetBrand? } | { type: "treatment", row? }
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(""); // "export" | "import" | `brand:<g>:<s>` | `clear:<row>:<s>` | `eye:<row>:<s>` | `del:<key>`
  const [imp, setImp] = useState(null);
  const [impBusy, setImpBusy] = useState(false);
  const [flash, setFlash] = useState(null); // row key just created
  const tableRef = useRef(null);
  const fileRef = useRef(null);

  const isFrames = section === "frames" || section === "cases";
  const truncated = Boolean(data?.truncated);
  const serverQ = truncated && q.trim().length >= 2 ? q.trim() : "";
  const rowIcon = section === "cases" ? "case" : "glasses";

  const loadBrands = useCallback(async () => {
    if (!isFrames) return null;
    try {
      const r = await fetchCatalogBrands();
      const list = Array.isArray(r?.brands) ? r.brands : [];
      setBrands(list);
      return list;
    } catch {
      // Sin registro la matriz sigue: las marcas salen con su monograma.
      setBrands((b) => b || []);
      return null;
    }
  }, [isFrames]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    try {
      const [d] = await Promise.all([fetchMatrix(section, { q: serverQ }), silent ? null : loadBrands()]);
      setData(d);
      setGroups(Array.isArray(d?.groups) ? d.groups : []);
      setState("ok");
      return d;
    } catch (e) {
      if (!silent) setState(e.message || "adm.err.pricing.load_failed");
      else toast({ tone: "error", title: t(e.message || "adm.err.pricing.load_failed") });
      return null;
    }
  }, [section, serverQ, loadBrands]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const allStores = useMemo(() => (Array.isArray(data?.stores) ? data.stores : []), [data]);
  // Every store is always a column (owner, 9-nov-2026: «no están saliendo todas
  // las tiendas»): picking a store in the global filter — which the POS also
  // does when you sell — used to leave only that column. Now the picked store
  // is highlighted and scrolled into view instead.
  const stores = allStores;
  const picked = onlyStore && allStores.some((s) => s.id === onlyStore) ? onlyStore : null;
  const storeIds = useMemo(() => stores.map((s) => s.id), [stores]);
  const costAccess = Boolean(data?.cost_access);

  // The registry adds the logo and the brands that have no model yet.
  const viewGroups = useMemo(() => withRegistry(groups, brands, section), [groups, brands, section]);
  // Default: the first group open the first time a section is seen.
  const openSet = useMemo(() => open || new Set(viewGroups.length ? [viewGroups[0].key] : []), [open, viewGroups]);
  const searching = q.trim().length > 0 || filters.size > 0;
  const shown = useMemo(() => filterGroups(viewGroups, { q, filters, storeIds }), [viewGroups, q, filters, storeIds]);
  // Frames and cases: what is sold in none of the shown stores goes last, under a separator.
  const ordered = useMemo(() => (isFrames ? orderOff(shown, storeIds) : { on: shown, off: [] }), [isFrames, shown, storeIds]);
  const isOpen = (g) => searching || openSet.has(g.key);
  const openGroup = (key, on = true) => {
    const next = new Set(openSet);
    if (on) next.add(key); else next.delete(key);
    setOpen(next);
    writeOpen(section, next);
  };
  const toggleGroup = (key) => openGroup(key, !openSet.has(key));
  const allOpen = viewGroups.length > 0 && viewGroups.every((g) => openSet.has(g.key));
  const toggleAll = () => {
    const next = allOpen ? new Set() : new Set(viewGroups.map((g) => g.key));
    setOpen(next);
    writeOpen(section, next);
  };

  const counts = useMemo(() => {
    const c = { rows: 0, nocost: 0, discount: 0, exact: 0, off: 0 };
    for (const g of viewGroups) {
      if (isFrames && !(g.rows || []).length && groupOff(g, storeIds)) c.off += 1;
    }
    for (const g of viewGroups) for (const r of g.rows || []) {
      c.rows += 1;
      if (isFrames && rowHiddenSome(r, g, storeIds)) c.off += 1;
      if (!(Number(r.cost_cents) > 0) && r.available !== false) c.nocost += 1;
      const cells = storeIds.map((id) => r.stores?.[id]).filter(Boolean);
      if (cells.some((x) => Number(x.discount_pct) > 0)) c.discount += 1;
      if (cells.some(isExact)) c.exact += 1;
    }
    return c;
  }, [viewGroups, storeIds, isFrames]);

  const toggleFilter = (f) => setFilters((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const errTitle = (e, fallback = "adm.err.pricing.save_failed") => t(knownErr(t, String(e?.message || ""), fallback));

  /* ───────────── Writes ───────────── */

  const save = useCallback(async (row, field, storeId, value) => {
    const kind = rowKind(row, section);
    const res = await saveMatrixCell({ kind, key: row.key, field, store: storeId, value });
    if (res?.row) {
      // Each row is its own cell, a photochromic's cost included: every lens
      // type (`code:sv`, `code:bifocal`, `code:prog`) has its own cost and price.
      setGroups((g) => replaceRow(g, res.row));
    } else load(true);
  }, [section, load]);

  /**
   * Brand price / discount of one store. Every model of the brand may change
   * (source «marca»), so the group comes back whole when the server sends it
   * (`{ group }` with its rows); otherwise the section is read again quietly.
   */
  const saveBrand = useCallback(async (group, field, storeId, value) => {
    const res = await saveMatrixCell({ kind: "brand", key: group.key, scope: brandScope(section), field, store: storeId, value });
    if (res?.group) setGroups((g) => replaceGroup(g, res.group));
    if (!Array.isArray(res?.group?.rows)) await load(true);
  }, [section, load]);

  const clearExact = async (row, store) => {
    const k = `clear:${row.key}:${store.id}`;
    if (busy) return;
    setBusy(k);
    try {
      await save(row, "price", store.id, null);
      toast({ tone: "success", title: t("adm.pm.clearedToRule", { store: store.code }) });
    } catch (e) {
      toast({ tone: "error", title: errTitle(e) });
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

  /**
   * General switch of a brand: on/off in EVERY store at once (catalog_brand.active).
   * The stores' own switches are kept and rule again when it is switched back on.
   */
  const toggleChain = async (group, label) => {
    const k = `chain:${group.key}`;
    if (busy) return;
    const turnOff = !brandOff(group);
    if (turnOff && !(await confirm({ tone: "danger", title: t("adm.pm.chainOffQ", { brand: label }), message: t("adm.pm.chainOffMsg") }))) return;
    setBusy(k);
    try {
      const res = await updateCatalogBrand(group.key, { active: !turnOff });
      const saved = { ...(res?.brand || {}), slug: group.key, active: !turnOff };
      setBrands((list) => {
        const all = list || [];
        return all.some((b) => b.slug === group.key) ? all.map((b) => (b.slug === group.key ? { ...b, ...saved } : b)) : [...all, { name: label, models: (group.rows || []).length, ...saved }];
      });
      setGroups((list) => list.map((g) => (g.key === group.key ? { ...g, active: !turnOff } : g)));
      // Every model's exposure changes: the server says what each store sells now.
      await load(true);
      toast({ tone: "success", title: t(turnOff ? "adm.pm.chainOffDone" : "adm.pm.chainOnDone", { brand: label }) });
    } catch (e) {
      toast({ tone: "error", title: errTitle(e) });
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

  /** Delete a model: the server deletes it if it never sold, else archives it (draft). */
  const removeModel = async (row) => {
    if (busy) return;
    if (!(await confirm({ tone: "danger", title: t("adm.pm.del.modelQ", { name: row.title }), message: t("adm.pm.del.modelMsg") }))) return;
    setBusy(`del:${row.key}`);
    try {
      const res = await deleteCatalogFrame(row.product_id || row.key);
      if (wasArchived(res)) {
        setGroups((g) => patchCell(g, row.key, null, { status: "draft" }));
        toast({ tone: "info", title: t("adm.pm.del.modelArchived", { name: row.title }) });
      } else {
        setGroups((g) => removeRow(g, row.key));
        toast({ tone: "success", title: t("adm.pm.del.modelDeleted", { name: row.title }) });
        loadBrands();
      }
    } catch (e) {
      toast({ tone: "error", title: errTitle(e) });
    } finally {
      setBusy("");
    }
  };

  /** Delete a brand: only when it has no models; otherwise the server's reason. */
  const removeBrand = async (g) => {
    if (busy) return;
    const name = groupLabel(g, t, lang);
    if (!(await confirm({ tone: "danger", title: t("adm.pm.del.brandQ", { name }), message: t("adm.pm.del.brandMsg") }))) return;
    setBusy(`del:${g.key}`);
    try {
      await deleteCatalogBrand(g.key);
      setBrands((list) => (list || []).filter((b) => b.slug !== g.key));
      setGroups((list) => list.filter((x) => x.key !== g.key || (x.rows || []).length > 0));
      toast({ tone: "success", title: t("adm.pm.del.brandDeleted", { name }) });
    } catch (e) {
      const n = Number(e?.payload?.models ?? e?.payload?.count ?? (g.rows || []).length);
      toast({ tone: "error", title: String(e?.message) === "adm.err.pricing.brand_has_models" ? t("adm.pm.del.brandHasModels", { name, n }) : errTitle(e) });
    } finally {
      setBusy("");
    }
  };

  /** Delete a treatment option (every category row of a photochromic goes). */
  const removeTreatment = async (row) => {
    if (busy) return;
    const code = treatmentCode(row);
    const name = lang === "en" ? row.label_en || row.label_es || row.title : row.label_es || row.title;
    if (!(await confirm({ tone: "danger", title: t("adm.pm.del.treatQ", { name }), message: t("adm.pm.del.treatMsg") }))) return;
    setBusy(`del:${row.key}`);
    try {
      const res = await deleteTreatment(code);
      if (wasArchived(res)) {
        toast({ tone: "info", title: t("adm.pm.del.treatArchived", { name }) });
        load(true);
      } else {
        setGroups((g) => g.map((x) => ({ ...x, rows: x.rows.filter((r) => treatmentCode(r) !== code) })));
        toast({ tone: "success", title: t("adm.pm.del.treatDeleted", { name }) });
      }
    } catch (e) {
      toast({ tone: "error", title: errTitle(e) });
    } finally {
      setBusy("");
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
        ...(plan.errors || []).map((er) => {
          const o = at(er.row);
          return o ? { ...er, row: o.row, detail: [o.sheet, er.detail].filter(Boolean).join(" · ") } : er;
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

  /* ───────────── After a dialog ───────────── */
  const afterSave = async ({ groupKey, sku, label, editing = false, rowKey = null }) => {
    setDialog(null);
    toast({ tone: "success", title: t(editing ? "adm.pm.updated" : "adm.pm.created", { name: label }) });
    const [d] = await Promise.all([load(true), isFrames ? loadBrands() : null]);
    const list = d?.groups || [];
    const g = list.find((x) => (rowKey && x.rows?.some((r) => r.key === rowKey)) || (sku && x.rows?.some((r) => r.sku === sku)) || x.key === groupKey)
      || (section === "treatments" ? list.find((x) => String(x.key).startsWith(groupKey)) : null) || null;
    if (g) {
      openGroup(g.key);
      const row = (rowKey && g.rows.find((r) => r.key === rowKey)) || (sku ? g.rows.find((r) => r.sku === sku) : g.rows[g.rows.length - 1]);
      if (row) setFlash(row.key);
    }
  };
  const afterBrand = (brand, { created }) => {
    setBrands((list) => {
      const rest = (list || []).filter((b) => b.slug !== brand.slug);
      return [...rest, { models: 0, active: true, ...brand }].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    });
    // A rename shows at once in the header (the matrix group carries its own label).
    if (!created) {
      setGroups((list) => list.map((g) => (g.key === brand.slug ? { ...g, label: brand.name ?? g.label, logo_url: brand.logo_url ?? null, active: brand.active !== false } : g)));
      // «Active» may have changed in the dialog: it is the general switch (every store's exposure).
      load(true);
    }
    toast({ tone: "success", title: t(created ? "adm.pm.created" : "adm.pm.updated", { name: brand.name }) });
    if (created && brandScope(section) === (brand.kind || "frame")) openGroup(brand.slug);
  };
  // The picked store's column comes into view (on a phone the matrix scrolls sideways).
  useEffect(() => {
    const box = tableRef.current;
    if (!box || !picked) return;
    const th = box.querySelector(`th[data-store="${CSS.escape(picked)}"]`);
    if (!th) return;
    const fixed = [...box.querySelectorAll("thead th.pm-corner")].reduce((w, el) => w + el.offsetWidth, 0);
    box.scrollTo({ left: Math.max(0, th.offsetLeft - fixed - 8), behavior: "smooth" });
  }, [picked, data]);

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
  const totalCols = fixedCols + stores.length * 2;
  const modelKind = section === "cases" ? "case" : "frame";
  const brandOf = (g) => g.registry || (brands || []).find((b) => b.slug === g.key) || null;
  const openAddModel = (g = null) => {
    const b = g ? brandOf(g) || { slug: g.key, name: g.label, kind: modelKind } : null;
    setDialog({ type: "frame", kind: modelKind, presetBrand: b });
  };

  return (
    <div className="pm" data-section={section}>
      <div className="pm-bar adm-noprint">
        <SearchBox value={q} onChange={setQ} placeholder={t(isFrames ? "adm.pm.searchFrames" : "adm.pm.search")} />
        <div className="pm-chips" role="group" aria-label={t("adm.pm.filters")}>
          {FILTERS.filter((f) => (f !== "nocost" || costAccess) && (f !== "off" || isFrames)).map((f) => (
            <button key={f} type="button" className={filters.has(f) ? "on" : ""} aria-pressed={filters.has(f)} onClick={() => toggleFilter(f)}>
              {f === "off" && <Icon name="eye" size={12} />}{t(`adm.pm.filter.${f}`)} <small>{counts[f]}</small>
            </button>
          ))}
        </div>
        <button type="button" className="btn-xs pm-ico" onClick={toggleAll} disabled={searching} title={t(allOpen ? "adm.pm.collapseAll" : "adm.pm.expandAll")} aria-label={t(allOpen ? "adm.pm.collapseAll" : "adm.pm.expandAll")}>
          <Icon name={allOpen ? "chevronUp" : "chevronDown"} size={15} />
        </button>
        <span className="pm-bar-gap" />
        <div className="pm-acts">
          {isFrames && (
            <>
              <button type="button" className="btn-xs pm-act-b" onClick={() => setDialog({ type: "brand" })} title={t("adm.pm.addBrandHint")}>
                <Icon name="tag" size={15} /> <span className="pm-bl">{t("adm.pm.addBrand")}</span>
              </button>
              <button type="button" className="btn-xs primary" onClick={() => openAddModel()}>
                <Icon name="plus" size={15} /> {t(section === "cases" ? "adm.pm.addCase" : "adm.pm.addFrame")}
              </button>
            </>
          )}
          {section === "treatments" && (
            <button type="button" className="btn-xs primary" onClick={() => setDialog({ type: "treatment" })}>
              <Icon name="plus" size={15} /> {t("adm.pm.addTreatment")}
            </button>
          )}
          <button type="button" className="btn-xs pm-act-x" onClick={exportExcel} disabled={Boolean(busy)} title={t("adm.pm.exportHint")} aria-label={t("adm.pm.export")}>
            <Icon name="download" size={15} /> <span className="pm-bl">{busy === "export" ? t("adm.pm.working") : t("adm.pm.exportShort")}</span>
          </button>
          <button type="button" className="btn-xs pm-act-x" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)} title={t("adm.pm.importHint")} aria-label={t("adm.pm.import")}>
            <Icon name="upload" size={15} /> <span className="pm-bl">{busy === "import" ? t("adm.pm.working") : t("adm.pm.importShort")}</span>
          </button>
        </div>
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
                  <th key={s.id} colSpan={2} scope="colgroup" data-store={s.id} className={`pm-store ${picked === s.id ? "is-picked" : ""}`} style={{ "--st": s.color || "var(--adm-accent)" }} title={`${s.code} · ${s.name}`}>
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
            {ordered.on.length + ordered.off.length === 0 && (
              <tbody>
                <tr><td className="pm-none" colSpan={totalCols}>{t(searching ? "adm.pm.noMatch" : "adm.pm.emptySection")}</td></tr>
              </tbody>
            )}
            {[...ordered.on, ...ordered.off].map((g, gi) => {
              const stats = groupStats(g, storeIds);
              const chainOff = brandOff(g);
              const firstOff = gi === ordered.on.length && ordered.off.length > 0;
              const expanded = isOpen(g);
              // Only a real brand group carries `stores` (its switch writes a brand rule).
              const brandLike = isBrandGroup(g, section);
              const label = groupLabel(g, t, lang);
              const reg = brandOf(g);
              return (
                <Fragment key={g.key}>
                {firstOff && (
                  <tbody className="pm-off-sep-g">
                    <tr><td colSpan={totalCols}><span className="pm-off-sep"><Icon name="eye" size={13} /> {t("adm.pm.offSep.brands", { n: ordered.off.length })}</span></td></tr>
                  </tbody>
                )}
                <tbody className={`pm-grp ${expanded ? "open" : ""} ${brandLike ? "is-brand" : ""} ${g.off ? "is-off" : ""}`}>
                  <tr className="pm-gh">
                    <th colSpan={fixedCols} className="pm-c-art pm-gh-name" scope="rowgroup">
                      <div className="pm-gh-in">
                        <button type="button" className="pm-gh-btn" aria-expanded={expanded} onClick={() => toggleGroup(g.key)} disabled={searching}>
                          <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />
                          {brandLike && <BrandLogo src={g.logo_url || reg?.logo_url} name={label} slug={g.key} />}
                          <span className="pm-gh-t">
                            <b title={label}>{label}</b>
                            <span className="pm-gh-meta">
                              <span className="pm-gh-n" title={t("adm.pm.modelsN", { n: stats.count })}>{stats.count}</span>
                              {chainOff && <em className="pm-draft">{t("adm.pm.brand.inactiveShort")}</em>}
                              {costAccess && stats.avgCostCents != null && <span className="pm-gh-s" title={t("adm.pm.avgCost")}>{t("adm.pm.avgCostShort")} {money(usd(stats.avgCostCents), "usd", lang)}</span>}
                              {stats.avgMargin != null && <span className={`pm-gh-s ${stats.avgMargin < 30 ? "low" : ""}`} title={t("adm.pm.avgMargin")}>{t("adm.pm.marginShort")} {pctText(stats.avgMargin)}</span>}
                            </span>
                          </span>
                        </button>
                        {brandLike && (
                          <label className={`pm-sw pm-chain ${chainOff ? "off" : ""}`} title={t(chainOff ? "adm.pm.chainOffHint" : "adm.pm.chainOnHint")}>
                            <input
                              type="checkbox"
                              role="switch"
                              checked={!chainOff}
                              disabled={busy === `chain:${g.key}`}
                              onChange={() => toggleChain(g, label)}
                              aria-label={t("adm.pm.chainAria", { brand: label })}
                            />
                            <span className="pm-chain-l">{t("adm.pm.chainShort")}</span>
                          </label>
                        )}
                        {brandLike && (
                          <MoreMenu
                            label={t("adm.pm.menu.brand", { name: label })}
                            items={[
                              { key: "add", icon: "plus", label: t(section === "cases" ? "adm.pm.menu.addCase" : "adm.pm.menu.addModel"), onSelect: () => openAddModel(g) },
                              { key: "edit", icon: "edit", label: t("adm.pm.menu.editBrand"), onSelect: () => setDialog({ type: "brand", brand: reg || { slug: g.key, name: label, kind: modelKind, logo_url: g.logo_url || null, active: true } }) },
                              { key: "del", icon: "trash", tone: "danger", label: t("adm.pm.menu.deleteBrand"), hint: (g.rows || []).length ? t("adm.pm.menu.deleteBrandHint") : undefined, disabled: busy === `del:${g.key}`, onSelect: () => removeBrand(g) },
                            ]}
                          />
                        )}
                      </div>
                    </th>
                    {stores.map((s) => {
                      const ps = stats.perStore[s.id] || {};
                      const st = { "--st": s.color || "var(--adm-accent)" };
                      if (!brandLike) {
                        return (
                          <td key={s.id} colSpan={2} className="pm-gh-store" style={st}>
                            <span className="pm-gh-cell">
                              {ps.margin != null && <span className={`pm-gh-m ${ps.margin < 30 ? "low" : ""}`} title={t("adm.pm.storeMargin", { store: s.code })}>{t("adm.pm.marginShort")} {pctText(ps.margin)}</span>}
                            </span>
                          </td>
                        );
                      }
                      const k = `brand:${g.key}:${s.id}`;
                      const bc = brandCell(g, s.id);
                      const fin = bc.priceCents != null && bc.pct ? Math.round(bc.priceCents * (1 - bc.pct / 100)) : null;
                      const visible = (g.rows || []).length ? Boolean(ps.visible) : g.stores?.[s.id]?.brand_rule !== false;
                      return (
                        <Fragment key={s.id}>
                          <td className={`pm-gh-store pm-c-price ${visible ? "" : "is-hidden"}`} style={st}>
                            <NumCell
                              field="price"
                              col={`bp:${s.id}`}
                              value={usd(bc.priceCents)}
                              onCommit={(v) => saveBrand(g, "price", s.id, v)}
                              onNav={onNav}
                              className={`has-sw ${bc.priceCents != null ? "exact" : ""}`}
                              placeholder="—"
                              label={t("adm.pm.cellBrandPrice", { brand: label, store: s.code })}
                              title={[t(bc.priceCents != null ? "adm.pm.brandPriceSet" : "adm.pm.brandPriceHint", { store: s.code }), ps.margin != null ? t("adm.pm.storeMargin", { store: s.code }) + `: ${pctText(ps.margin)}` : null].filter(Boolean).join(" · ")}
                              sub={ps.margin != null ? <span className={`pm-gh-mg ${ps.margin < 30 ? "low" : ""}`}>{t("adm.pm.marginShort")} {pctText(ps.margin)}</span> : null}
                            >
                              <label className={`pm-sw pm-gh-sw ${chainOff ? "locked" : ""}`} title={t(chainOff ? "adm.pm.chainLockedHint" : visible ? "adm.pm.brandVisibleHint" : "adm.pm.brandHiddenHint", { store: s.code })}>
                                <input
                                  type="checkbox"
                                  role="switch"
                                  checked={visible && !chainOff}
                                  disabled={busy === k || chainOff}
                                  onChange={() => toggleBrand(g, s, visible)}
                                  aria-label={t("adm.pm.brandVisibleAria", { brand: label, store: s.code })}
                                />
                              </label>
                            </NumCell>
                          </td>
                          <td className={`pm-gh-store pm-c-disc ${visible ? "" : "is-hidden"}`}>
                            <NumCell
                              field="discount"
                              col={`bd:${s.id}`}
                              value={bc.pct}
                              onCommit={(v) => saveBrand(g, "discount", s.id, v)}
                              onNav={onNav}
                              className={bc.pct ? "has-disc" : ""}
                              placeholder="—"
                              label={t("adm.pm.cellBrandDiscount", { brand: label, store: s.code })}
                              title={t("adm.pm.brandDiscountHint", { store: s.code })}
                              sub={fin != null ? money(usd(fin), "usd", lang) : null}
                            />
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                  {expanded && brandLike && (g.rows || []).length === 0 && (
                    <tr className="pm-row pm-row-empty">
                      <td colSpan={totalCols}>
                        <span className="pm-empty-brand">
                          <Icon name={rowIcon} size={16} /> {t("adm.pm.brand.noModels")}
                          <button type="button" className="btn-xs primary" onClick={() => openAddModel(g)}><Icon name="plus" size={14} /> {t("adm.pm.brand.addFirst")}</button>
                        </span>
                      </td>
                    </tr>
                  )}
                  {expanded && g.rows.map((r, ri) => {
                    const ct = costTone(r.cost_source);
                    const title = rowTitle(r, t, lang);
                    const draft = r.status && r.status !== "published";
                    const offRow = isFrames && ri >= (g.offAt ?? g.rows.length);
                    // Separator before the first model sold nowhere (not when the whole group is off).
                    const sep = isFrames && ri > 0 && ri === g.offAt;
                    return (
                      <Fragment key={r.key}>
                      {sep && (
                        <tr className="pm-row pm-off-sep-r">
                          <td colSpan={totalCols}><span className="pm-off-sep"><Icon name="eye" size={12} /> {t("adm.pm.offSep.models", { n: g.rows.length - g.offAt })}</span></td>
                        </tr>
                      )}
                      <tr data-key={r.key} className={`pm-row ${isFrames ? "has-thumb" : ""} ${draft ? "is-draft" : ""} ${offRow ? "is-off" : ""} ${flash === r.key ? "is-new" : ""}`}>
                        <th scope="row" className="pm-c-art">
                          <span className="pm-art">
                            {isFrames && <Thumb src={r.thumbnail} icon={rowIcon} size={40} />}
                            <span className="pm-art-t">
                              <b title={title}>{title}</b>
                              <small>
                                {r.sku && r.sku !== r.title ? r.sku : section === "lenses" || section === "treatments" ? r.key : ""}
                                {draft && <em className="pm-draft">{t("adm.pm.draft")}</em>}
                                {isNewModel(r) && <em className="pm-new">{t("adm.pm.new")}</em>}
                                {r.available === false && <em className="pm-draft" title={t("adm.pm.digitalOffHint")}>{t("adm.pm.digitalOff")}</em>}
                              </small>
                            </span>
                            {isFrames && r.product_id && (
                              <MoreMenu
                                label={t("adm.pm.menu.model", { name: title })}
                                items={[
                                  { key: "edit", icon: "edit", label: t("adm.pm.menu.editModel"), onSelect: () => setDialog({ type: "frame", kind: modelKind, row: r }) },
                                  { key: "status", icon: "power", label: t(draft ? "adm.pm.reactivate" : "adm.pm.discontinue"), onSelect: () => toggleStatus(r) },
                                  { key: "del", icon: "trash", tone: "danger", label: t("adm.pm.menu.deleteModel"), hint: t("adm.pm.menu.deleteModelHint"), disabled: busy === `del:${r.key}`, onSelect: () => removeModel(r) },
                                ]}
                              />
                            )}
                            {section === "treatments" && (
                              <MoreMenu
                                label={t("adm.pm.menu.treat", { name: title })}
                                items={[
                                  { key: "edit", icon: "edit", label: t("adm.pm.menu.editTreat"), onSelect: () => setDialog({ type: "treatment", row: r }) },
                                  { key: "del", icon: "trash", tone: "danger", label: t("adm.pm.menu.deleteTreat"), hint: t("adm.pm.menu.deleteTreatHint"), disabled: busy === `del:${r.key}`, onSelect: () => removeTreatment(r) },
                                ]}
                              />
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
                              label={t("adm.pm.cellCost", { item: title })}
                              title={t(r.available === false ? "adm.pm.digitalOffCost" : ct ? `adm.pm.costSrc.${ct}` : r.cost_cents > 0 ? "adm.pm.costList" : "adm.pm.costMissing")}
                              sub={ct && Number(r.cost_cents) > 0 ? <Pill tone={ct}>{t(`adm.pm.pill.cost.${ct}`)}</Pill> : null}
                            />
                          </td>
                        )}
                        {stores.map((s) => {
                          const cell = r.stores?.[s.id] || {};
                          const exact = isExact(cell);
                          const pct = Number(cell.discount_pct) || 0;
                          const fin = finalCents(cell);
                          const hidden = isFrames && cell.exposed === false;
                          const margin = costAccess ? marginOf(fin, r.cost_cents) : null;
                          const tone = sourceTone(cell.source);
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
                                  sub={cell.price_cents != null && r.available !== false ? <Pill tone={tone}>{t(`adm.pm.pill.${tone}`)}</Pill> : null}
                                >
                                  {isFrames && (
                                    <button
                                      type="button"
                                      className={`pm-eye ${hidden ? "off" : ""}`}
                                      tabIndex={-1}
                                      disabled={busy === `eye:${r.key}:${s.id}` || chainOff}
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => toggleExposure(r, s)}
                                      title={chainOff ? t("adm.pm.chainLockedHint", { store: s.code }) : t(hidden ? "adm.pm.showIn" : "adm.pm.hideIn", { store: s.code })}
                                      aria-label={t(hidden ? "adm.pm.showIn" : "adm.pm.hideIn", { store: s.code })}
                                      aria-pressed={!hidden}
                                    >
                                      <Icon name="eye" size={13} />
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
                      </Fragment>
                    );
                  })}
                </tbody>
                </Fragment>
              );
            })}
          </table>
        </div>
      </div>

      <p className="pm-legend adm-noprint">
        {["exact", ...(isFrames ? ["brand"] : []), "rule", "band", "master"].map((k) => (
          <span key={k} title={t(`adm.pm.src.${k}`)}><Pill tone={k}>{t(`adm.pm.pill.${k}`)}</Pill></span>
        ))}
        {costAccess && isFrames && <span className="pm-lg-sep" aria-hidden="true" />}
        {costAccess && isFrames && ["c2026", "prev", "own"].map((k) => (
          <span key={k} title={t(`adm.pm.costSrc.${k}`)}><Pill tone={k}>{t(`adm.pm.pill.cost.${k}`)}</Pill></span>
        ))}
        {isFrames && <span><Icon name="eye" size={12} /> {t("adm.pm.legend.eye")}</span>}
        {isFrames && <span><b className="pm-chain-l">{t("adm.pm.chainShort")}</b> {t("adm.pm.legend.chain")}</span>}
        <span><Icon name="arrowRight" size={12} /> {t("adm.pm.legend.keys")}</span>
      </p>

      {dialog?.type === "brand" && (
        <BrandDialog
          brand={dialog.brand || null}
          kind={modelKind}
          takenSlugs={new Set((brands || []).map((b) => b.slug))}
          onClose={() => setDialog(null)}
          onSaved={afterBrand}
          onAddFirst={(b) => setDialog({ type: "frame", kind: b.kind === "case" ? "case" : "frame", presetBrand: b })}
        />
      )}
      {dialog?.type === "frame" && (
        <FrameDialog
          kind={dialog.kind}
          row={dialog.row || null}
          presetBrand={dialog.presetBrand || null}
          brands={brands && brands.length ? brands : null}
          stores={allStores}
          groups={groups}
          costAccess={costAccess}
          onClose={() => setDialog(null)}
          onSaved={(res, body, { editing }) => afterSave({
            groupKey: body.brand_slug || slugify(body.brand),
            sku: res?.row?.sku || res?.product?.sku || body.sku,
            rowKey: res?.row?.key || dialog.row?.key || null,
            label: [body.brand, body.model].filter(Boolean).join(" "),
            editing,
          })}
        />
      )}
      {dialog?.type === "treatment" && (
        <TreatmentDialog
          row={dialog.row || null}
          groups={groups}
          costAccess={costAccess}
          onClose={() => setDialog(null)}
          onCreated={(res, body, { editing } = {}) => afterSave({
            groupKey: body.type === "photo" ? "photo" : "ar",
            sku: null,
            rowKey: dialog.row?.key || null,
            label: lang === "en" ? body.label_en : body.label_es,
            editing,
          })}
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
