// Dónde se usa: pestaña Productos de /admin — precios reales vía Admin API, descontinuar monturas/marcas y export a Excel/CSV.
import { useEffect, useMemo, useState } from "react";
import { useCatalog, loadLive } from "../data/catalogStore.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import {
  setProductStatus, setBrandStatus, setFramePrice,
  fetchDiscontinued, exportCatalogCsv, exportCatalogExcel,
} from "./catalogAdmin.js";

const usd = (n) => "$" + (Number(n) || 0).toFixed(2);

/**
 * GESTIÓN DEL CATÁLOGO (real, vía Admin API de Medusa):
 *  · cambiar el precio de venta de una montura (todas sus variantes/colores);
 *  · descontinuar / reactivar una montura (status draft ↔ published);
 *  · descontinuar / reactivar una MARCA completa;
 *  · exportar el catálogo entero a Excel (.xls) o CSV.
 * Con el login demo todo queda deshabilitado y explicado: sin backend no hay
 * catálogo que modificar de verdad.
 */
export default function CatalogManager() {
  const { t } = useLang();
  const { toast, confirm } = useFeedback();
  const { products, cases } = useCatalog();
  const demo = isDemoLogin();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);        // slug | "brand:<slug>" | "export"
  const [price, setPrice] = useState({});        // slug -> draft price
  const [off, setOff] = useState([]);            // descontinuadas (draft en Medusa)
  const [progress, setProgress] = useState(null); // {done,total} en lotes de marca

  const refreshOff = () => { if (!demo) fetchDiscontinued().then(setOff).catch(() => {}); };
  useEffect(refreshOff, [demo]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? products.filter((p) => `${p.name} ${p.brand}`.toLowerCase().includes(needle))
      : products;
    return base.slice(0, 60);
  }, [products, q]);

  const brands = useMemo(() => {
    const m = new Map();
    for (const p of products) if (p.brand_slug) m.set(p.brand_slug, { slug: p.brand_slug, name: p.brand, n: (m.get(p.brand_slug)?.n || 0) + 1 });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [products]);

  const doExport = (kind) => {
    setBusy("export");
    try {
      const n = kind === "csv" ? exportCatalogCsv(products, cases) : exportCatalogExcel(products, cases);
      toast({ tone: "success", title: t("adm.cat.exported", { n }) });
    } finally { setBusy(null); }
  };

  const doPrice = async (p) => {
    const value = price[p.slug];
    if (!value) return;
    setBusy(p.slug);
    try {
      await setFramePrice(p, value);
      toast({ tone: "success", title: t("adm.cat.priceSaved", { name: p.name, price: usd(value) }) });
      setPrice((s) => ({ ...s, [p.slug]: "" }));
      loadLive({ force: true }).catch(() => {});
    } catch {
      toast({ tone: "error", title: t("adm.cat.priceFailed") });
    } finally { setBusy(null); }
  };

  const doStatus = async (p, discontinue) => {
    const ok = await confirm({
      title: t(discontinue ? "adm.cat.offConfirm" : "adm.cat.onConfirm", { name: p.name }),
      message: t(discontinue ? "adm.cat.offBody" : "adm.cat.onBody"),
    });
    if (!ok) return;
    setBusy(p.slug || p.medusaId);
    try {
      await setProductStatus(p.medusaId, discontinue);
      toast({ tone: "success", title: t(discontinue ? "adm.cat.offDone" : "adm.cat.onDone", { name: p.name }) });
      refreshOff();
      loadLive({ force: true }).catch(() => {});
    } catch {
      toast({ tone: "error", title: t("adm.cat.statusFailed") });
    } finally { setBusy(null); }
  };

  const doBrand = async (b, discontinue) => {
    const ok = await confirm({
      title: t(discontinue ? "adm.cat.brandOffConfirm" : "adm.cat.brandOnConfirm", { name: b.name, n: b.n }),
      message: t("adm.cat.brandBody"),
    });
    if (!ok) return;
    setBusy("brand:" + b.slug);
    setProgress({ done: 0, total: b.n });
    try {
      const r = await setBrandStatus(products, b.slug, discontinue, (done, total) => setProgress({ done, total }));
      toast({
        tone: r.failed.length ? "info" : "success",
        title: t("adm.cat.brandDone", { name: b.name, done: r.done, total: r.total }),
        message: r.failed.length ? t("adm.cat.brandFailed", { n: r.failed.length }) : undefined,
      });
      refreshOff();
      loadLive({ force: true }).catch(() => {});
    } finally { setBusy(null); setProgress(null); }
  };

  return (
    <div className="adm-card adm-catmgr">
      <div className="adm-head-row">
        <h3>{t("adm.cat.title")}</h3>
        <div className="adm-cat-tools">
          {/* Icono de descarga 3D navy de la lámina (respaldo: flecha unicode). */}
          <button className="btn-sm adm-export" disabled={busy === "export"} onClick={() => doExport("xls")}>
            <img className="i3d-dl" src="/ui/icons3d/navy-download.png" alt="" onError={(e) => { e.currentTarget.parentElement.classList.add("no-i3d"); e.currentTarget.remove(); }} />
            <span className="adm-export-fb">⬇</span> {t("adm.cat.exportXls")}
          </button>
          <button className="btn-sm adm-export" disabled={busy === "export"} onClick={() => doExport("csv")}>
            <img className="i3d-dl" src="/ui/icons3d/navy-download.png" alt="" onError={(e) => { e.currentTarget.parentElement.classList.add("no-i3d"); e.currentTarget.remove(); }} />
            <span className="adm-export-fb">⬇</span> {t("adm.cat.exportCsv")}
          </button>
        </div>
      </div>
      {demo && <p className="adm-sub">{t("adm.cat.demoNote")}</p>}

      {/* Marcas: descontinuar/reactivar en bloque */}
      <div className="adm-cat-brands">
        {brands.map((b) => (
          <span key={b.slug} className="adm-cat-brand">
            <b>{b.name}</b> <small>({b.n})</small>
            <button className="btn-xs" disabled={demo || !!busy} title={t("adm.cat.brandOff")}
                    onClick={() => doBrand(b, true)}>⏸</button>
          </span>
        ))}
        {progress && <span className="adm-cat-progress">{progress.done}/{progress.total}…</span>}
      </div>

      {/* Buscador + filas editables */}
      <div className="adm-find compact adm-cat-find">
        <span aria-hidden="true">🔎</span>
        <input placeholder={t("adm.cat.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="adm-cat-rows">
        {list.map((p) => (
          <div key={p.slug} className="adm-cat-row">
            <div className="adm-tb-thumb sm">{p.colors?.[0]?.image ? <img src={p.colors[0].image} alt="" loading="lazy" /> : <span>◈</span>}</div>
            <div className="adm-cat-main">
              <b>{p.name}</b>
              <small className="muted">{p.brand} · {usd(p.price)}</small>
            </div>
            <div className="adm-cat-actions">
              <span className="adm-cat-price">
                <input inputMode="decimal" placeholder={String(p.price)} value={price[p.slug] ?? ""}
                       onChange={(e) => setPrice((s) => ({ ...s, [p.slug]: e.target.value.replace(/[^0-9.]/g, "") }))} />
                <button className="btn-xs primary" disabled={demo || busy === p.slug || !price[p.slug]}
                        onClick={() => doPrice(p)}>{t("adm.cat.savePrice")}</button>
              </span>
              <button className="btn-xs warn" disabled={demo || busy === p.slug}
                      onClick={() => doStatus(p, true)}>{t("adm.cat.off")}</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="adm-nodata">{t("adm.chart.noData")}</div>}
      </div>

      {/* Descontinuadas: visibles y reactivables */}
      {off.length > 0 && (
        <div className="adm-cat-off">
          <h4>{t("adm.cat.offList", { n: off.length })}</h4>
          <div className="adm-cat-rows">
            {off.map((p) => (
              <div key={p.medusaId} className="adm-cat-row off">
                <div className="adm-tb-thumb sm">{p.image ? <img src={p.image} alt="" loading="lazy" /> : <span>◈</span>}</div>
                <div className="adm-cat-main"><b>{p.name}</b><small className="muted">{t("adm.cat.offTag")}</small></div>
                <div className="adm-cat-actions">
                  <button className="btn-xs primary" disabled={demo || !!busy}
                          onClick={() => doStatus({ medusaId: p.medusaId, name: p.name, slug: p.slug }, false)}>
                    {t("adm.cat.on")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
