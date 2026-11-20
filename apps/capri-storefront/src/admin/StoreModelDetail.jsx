// Dónde se usa: Tiendas → Catálogo, al hacer clic en un modelo. Ficha del modelo
// tal como lo ve esa tienda: fotos por color, medidas, precio base y precio en la
// tienda, y qué regla decide si está a la venta. Backend:
// GET /admin/store-assortment/:id/products/:productId.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { resolveImage, resolveImageSized } from "../data/imageUrl.js";
import { money } from "./adminOrders.js";
import { fetchStoreModel } from "./adminStores.js";

export default function StoreModelDetail({ storeId, productId, storeCode }) {
  const { t, lang } = useLang();
  const [p, setP] = useState(null);
  const [state, setState] = useState("loading");
  const [photo, setPhoto] = useState(null);

  useEffect(() => {
    let on = true;
    setState("loading");
    fetchStoreModel(storeId, productId)
      .then((r) => { if (on) { setP(r.product); setPhoto(r.product.thumbnail || r.product.images[0] || null); setState("ok"); } })
      .catch(() => { if (on) setState("error"); });
    return () => { on = false; };
  }, [storeId, productId]);

  if (state === "loading") return <div className="adm-src-note loading">{t("adm.ord.loading")}</div>;
  if (state === "error" || !p) return <div className="adm-demo-banner">{t("adm.err.assortment.detailFailed")}</div>;

  const fmt = (v) => (v == null ? "—" : money(v, "usd", lang));
  const a = p.attributes;
  const size = [a.eye_size, a.bridge_size, a.temple_length].some((v) => v != null)
    ? [a.eye_size, a.bridge_size, a.temple_length].map((v) => (v == null ? "—" : v)).join(" · ") + " mm"
    : null;
  const description = (lang === "es" && p.description.es) || p.description.en || p.description.es;
  const specs = [
    [t("adm.assort.d.size"), size],
    [t("adm.assort.d.material"), a.material],
    [t("adm.assort.d.shape"), a.shape],
    [t("adm.assort.d.gender"), a.gender],
    [t("adm.assort.d.features"), a.features.length ? a.features.join(", ") : null],
  ].filter(([, v]) => v);

  return (
    <div className="adm-model-detail">
      <div className="adm-model-gallery">
        {photo
          ? <img className="adm-model-photo" src={resolveImageSized(photo, 560)} alt={p.title} />
          : <div className="adm-model-photo adm-model-nophoto">{t("adm.assort.d.noPhoto")}</div>}
        {p.colors.length > 0 && (
          <div className="adm-model-colors">
            {p.colors.map((c) => (
              <button type="button" key={c.id} className={`adm-model-color ${c.image && c.image === photo ? "on" : ""}`}
                disabled={!c.image} onClick={() => setPhoto(c.image)} title={c.sku || c.title} aria-label={t("adm.assort.d.showColor", { color: c.title })}>
                {c.image && <img src={resolveImageSized(c.image, 120)} alt="" />}
                <span>{c.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="adm-model-info">
        <h4>{p.title} <small className="muted">· {p.brand_name}</small></h4>
        <div className="adm-pricing-preview">
          <span>{t("adm.pricing.pvBase")} <b>{fmt(p.base_price)}</b></span>
          <span>{t("adm.pricing.pvStore", { code: storeCode })} <b>{fmt(p.store_price)}</b></span>
          {p.price_source === "store_exact" && <span className="adm-chip gold">{t("adm.assort.d.exactPrice")}</span>}
        </div>
        <p className="adm-sub">
          <span className={`adm-chip ${p.exposed ? "ok" : "bad"}`}>{t(p.exposed ? "adm.assort.exposed" : "adm.assort.hidden")}</span>{" "}
          {t(`adm.assort.d.by.${p.exposed_by}`)}
        </p>
        {specs.length > 0 && (
          <dl className="adm-model-specs">
            {specs.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
          </dl>
        )}
        {description && <p className="adm-model-desc">{description}</p>}
        {p.images.length > 0 && (
          <a className="btn-xs" href={resolveImage(photo || p.images[0])} target="_blank" rel="noreferrer">{t("adm.assort.d.openPhoto")}</a>
        )}
      </div>
    </div>
  );
}
