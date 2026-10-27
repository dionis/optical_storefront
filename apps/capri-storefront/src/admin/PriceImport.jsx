// Dónde se usa: pestaña Tiendas de /admin — convierte la lista de precios del
// dueño (pestaña Precios, guardada solo en su navegador) en precio base real de
// la web y de todas las tiendas. Primero muestra el plan; aplicar es otro paso.
// Backend: POST /admin/store-pricing/import (lib/price-import.ts).
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { money } from "./adminOrders.js";
import { rawOverrides } from "./priceStore.js";
import { importOwnerPrices } from "./adminStores.js";
import Icon from "./icons.jsx";

const hasAny = (o) => o && ["frames", "cases", "lens", "materials", "treatments", "usage"].some((k) => o[k] && Object.keys(o[k]).length);

export default function PriceImport() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [list, setList] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const local = rawOverrides();

  const analyse = async (prices) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await importOwnerPrices(prices, false);
      setList(prices);
      setPlan(r.plan);
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const fromFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { analyse(JSON.parse(String(rd.result))); }
      catch { toast({ tone: "error", title: t("adm.err.pricing.bad_price_list") }); }
    };
    rd.readAsText(file);
  };

  const apply = async () => {
    const ok = await confirm({ tone: "danger", title: t("adm.priceImport.confirm"), message: t("adm.priceImport.confirmBody", { n: plan.products.length }) });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await importOwnerPrices(list, true);
      toast({ tone: "success", title: t("adm.priceImport.done", { products: r.result.products, lens: r.result.lens_cells }) });
      setPlan(null);
      setList(null);
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const lensCount = plan ? plan.lens.base.length + plan.lens.photo.length + plan.lens.ar.length : 0;

  return (
    <div className="adm-card">
      <h3><Icon name="upload" size={16} />{t("adm.priceImport.title")}</h3>
      <p className="adm-sub">{t("adm.priceImport.intro")}</p>
      <div className="adm-pricing-row">
        <button className="btn-sm primary" disabled={busy || !hasAny(local)} onClick={() => analyse(local)}>{t("adm.priceImport.fromBrowser")}</button>
        <label className="btn-sm">
          {t("adm.priceImport.fromFile")}
          <input type="file" accept="application/json,.json" hidden onChange={fromFile} />
        </label>
      </div>
      {!hasAny(local) && <small className="muted">{t("adm.priceImport.noLocal")}</small>}

      {plan && (
        <div className="adm-pricing-block">
          <h4>{t("adm.priceImport.planTitle")}</h4>
          <ul className="adm-pricing-history">
            <li><b>{plan.products.length}</b> {t("adm.priceImport.planProducts")}</li>
            <li><b>{lensCount}</b> {t("adm.priceImport.planLens")}</li>
            <li><b>{plan.skipped.length}</b> {t("adm.priceImport.planSkipped")}</li>
          </ul>
          {plan.products.length > 0 && (
            <details>
              <summary>{t("adm.priceImport.showProducts")}</summary>
              <ul className="adm-pricing-history">
                {plan.products.map((p) => <li key={p.product_id}><span>{p.title}</span><b>{money(p.price, "usd", lang)}</b></li>)}
              </ul>
            </details>
          )}
          {plan.skipped.length > 0 && (
            <details>
              <summary>{t("adm.priceImport.showSkipped")}</summary>
              <ul className="adm-pricing-history">
                {plan.skipped.map((s, i) => <li key={`${s.group}:${s.key}:${i}`} className="closed"><span>{s.group} · {s.key}</span><span>{t(`adm.priceImport.reason.${s.reason}`)}</span></li>)}
              </ul>
            </details>
          )}
          <div className="adm-actions" style={{ marginTop: 12 }}>
            <button className="btn-sm primary" disabled={busy || (plan.products.length === 0 && lensCount === 0)} onClick={apply}>{t("adm.priceImport.apply")}</button>
            <button className="btn-sm" disabled={busy} onClick={() => { setPlan(null); setList(null); }}>{t("adm.pricing.close")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
