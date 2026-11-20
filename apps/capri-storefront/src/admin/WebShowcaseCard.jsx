// Dónde se usa: Tiendas → debajo de «Tienda online» (Stores.jsx).
// «Vitrina de la tienda web» (dueño, 20-nov-2026): qué marcas enseña primero la
// web como ejemplos — «Los más vendidos» de la portada y el orden «Relevancia»
// del catálogo. Antes siempre abría con la primera colección del proveedor.
// Tres modos: el orden del catálogo (como antes), marcas elegidas (en el orden
// que el dueño les dé, por turnos) o mezcla al azar entre marcas (las elegidas
// o todas), distinta en cada visita. Solo cambia el orden: no oculta monturas
// ni toca precios. La vista previa usa la MISMA función que la tienda
// (data/showcase.js) sobre el número de modelos de cada marca.
// Datos: GET/POST /admin/web-showcase (solo dueño y superadmin).
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminFetch } from "./adminApi.js";
import { showcaseOrder } from "../data/showcase.js";
import "./web-showcase.css";

const MODES = ["catalog", "brands", "random"];
const PREVIEW = 12;
// Los `reason` de POST /admin/web-showcase con texto propio (adm.wsc.err.*); el resto, el genérico.
const ERR_REASONS = new Set(["bad_mode", "bad_brands", "too_many_brands", "unknown_brand", "brands_required", "forbidden_role", "load_failed", "save_failed", "offline"]);

export default function WebShowcaseCard({ demo = false }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("catalog");
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [seed, setSeed] = useState(1);

  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    // Sin permiso o con un backend anterior no hay tarjeta: la pantalla sigue igual.
    adminFetch("/admin/web-showcase")
      .then((r) => {
        if (!on) return;
        setData(r);
        setMode(r.showcase.mode);
        setPicked(r.showcase.brands);
      })
      .catch(() => on && setData(null));
    return () => { on = false; };
  }, [demo]);

  const brands = data?.brands || [];
  const nameOf = useMemo(() => new Map(brands.map((b) => [b.slug, b.name])), [brands]);
  const saved = data?.showcase;
  const dirty = Boolean(saved) && (mode !== saved.mode || JSON.stringify(mode === "catalog" ? [] : picked) !== JSON.stringify(saved.brands));
  const needsBrands = mode === "brands" && !picked.length;

  // Vista previa: marcas de los primeros 12 ejemplos, con la función de la tienda.
  const preview = useMemo(() => {
    const fake = brands.flatMap((b) => Array.from({ length: Math.min(b.models, PREVIEW) }, (_, i) => ({ slug: `${b.slug}:${i}`, brand_slug: b.slug })));
    return showcaseOrder(fake, { mode, brands: picked }, seed).slice(0, PREVIEW).map((p) => nameOf.get(p.brand_slug) || p.brand_slug);
  }, [brands, mode, picked, seed, nameOf]);

  if (!data) return null;

  const toggle = (slug) => setPicked((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));
  const move = (i, d) => setPicked((cur) => {
    const j = i + d;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    if (busy || needsBrands) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminFetch("/admin/web-showcase", { method: "POST", body: { mode, brands: mode === "catalog" ? [] : picked } });
      setData((d) => ({ ...d, showcase: r.showcase }));
      setPicked(r.showcase.brands);
      setMsg({ ok: true, text: t("adm.wsc.saved") });
    } catch (err) {
      setMsg({ ok: false, text: t(ERR_REASONS.has(err?.reason) ? `adm.wsc.err.${err.reason}` : "adm.wsc.err.save_failed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-card wsc">
      <h3><Icon name="sparkles" size={16} />{t("adm.wsc.title")}</h3>
      <p className="adm-sub wsc-sub">{t("adm.wsc.sub")}</p>

      <div className="wsc-modes" role="radiogroup" aria-label={t("adm.wsc.modeAria")}>
        {MODES.map((m) => (
          <label key={m} className={`wsc-mode ${mode === m ? "on" : ""}`}>
            <input type="radio" name="wsc-mode" value={m} checked={mode === m} disabled={busy} onChange={() => setMode(m)} />
            <span>
              <b>{t(`adm.wsc.mode.${m}`)}</b>
              <small>{t(`adm.wsc.mode.${m}Hint`)}</small>
            </span>
          </label>
        ))}
      </div>

      {mode !== "catalog" && (
        <>
          <p className="adm-sub wsc-pick-title">{t(mode === "brands" ? "adm.wsc.pickBrands" : "adm.wsc.pickRandom")}</p>
          {!brands.length && <p className="adm-nodata">{t("adm.wsc.noBrands")}</p>}
          <div className="wsc-chips">
            {brands.map((b) => {
              const on = picked.includes(b.slug);
              return (
                <button
                  key={b.slug}
                  type="button"
                  className={`wsc-chip ${on ? "on" : ""}`}
                  aria-pressed={on}
                  disabled={busy}
                  title={t("adm.wsc.models", { n: b.models })}
                  onClick={() => toggle(b.slug)}
                >
                  {on && <Icon name="check" size={12} />}
                  {b.name}
                  <small>{b.models}</small>
                </button>
              );
            })}
          </div>

          {mode === "brands" && picked.length > 1 && (
            <ol className="wsc-order" aria-label={t("adm.wsc.orderAria")}>
              {picked.map((slug, i) => (
                <li key={slug}>
                  <span>{nameOf.get(slug) || slug}</span>
                  <button type="button" className="btn-xs" disabled={busy || i === 0} aria-label={t("adm.wsc.up", { name: nameOf.get(slug) || slug })} title={t("adm.wsc.up", { name: nameOf.get(slug) || slug })} onClick={() => move(i, -1)}>
                    <Icon name="chevronUp" size={12} />
                  </button>
                  <button type="button" className="btn-xs" disabled={busy || i === picked.length - 1} aria-label={t("adm.wsc.down", { name: nameOf.get(slug) || slug })} title={t("adm.wsc.down", { name: nameOf.get(slug) || slug })} onClick={() => move(i, 1)}>
                    <Icon name="chevronDown" size={12} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {needsBrands && <p className="wsc-warn"><Icon name="alert" size={13} />{t("adm.wsc.needBrands")}</p>}
        </>
      )}

      <div className="wsc-preview">
        <span className="wsc-preview-title">{t("adm.wsc.preview", { n: PREVIEW })}</span>
        <span className="wsc-preview-list">
          {mode === "catalog"
            ? <span className="adm-sub">{t("adm.wsc.previewCatalog")}</span>
            : preview.length ? preview.map((name, i) => <span key={i} className="adm-chip">{name}</span>) : <span className="adm-sub">{t("adm.wsc.noBrands")}</span>}
        </span>
        {mode === "random" && (
          <button type="button" className="btn-xs" onClick={() => setSeed((s) => s + 1)} title={t("adm.wsc.shuffleHint")}>
            <Icon name="rotate" size={12} />{t("adm.wsc.shuffle")}
          </button>
        )}
      </div>

      <div className="adm-actions wsc-actions">
        <button type="button" className="btn-sm primary" disabled={!dirty || busy || needsBrands} onClick={save}>
          <Icon name="save" size={14} />{busy ? t("adm.wsc.saving") : t("adm.wsc.save")}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn-sm" onClick={() => { setMode(saved.mode); setPicked(saved.brands); setMsg(null); }}>
            <Icon name="undo" size={14} />{t("adm.wsc.discard")}
          </button>
        )}
        {msg && <span className={`wsc-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</span>}
      </div>
      <p className="adm-sub wsc-note"><Icon name="info" size={13} />{t("adm.wsc.note")}</p>
    </div>
  );
}
