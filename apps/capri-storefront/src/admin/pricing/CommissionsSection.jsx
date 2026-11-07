// Dónde se usa: «Productos y precios» → «Reglas y comisiones» → acordeón
// «Comisiones». Compacto (7-nov-2026, el dueño: «la tarjeta estrecha con una
// lista larga desperdicia espacio»): la comisión por defecto en una línea y
// cada vendedor como una ficha pequeña con su % en el sitio, en una rejilla de
// varias columnas. La comisión por defecto es la ÚNICA fuente: con ella nace
// cada vendedor nuevo (Vendedores, Equipo) y es la que se paga a quien vende
// sin % propio (lib/commission-pct.ts en el servidor). Datos: el bloque
// `commissions` de GET /admin/finance/rules; se guarda con POST
// /admin/pricing/commissions (solo lo que cambió).
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import HelpTip from "../HelpTip.jsx";
import Icon from "../icons.jsx";
import { saveCommissions } from "../finance/financeApi.js";

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function CommissionsSection({ commissions, stores = [], earned = [], onSaved, onError }) {
  const { t, lang } = useLang();
  const [defaultPct, setDefaultPct] = useState(commissions.default_pct == null ? "" : String(commissions.default_pct));
  const [pcts, setPcts] = useState(() => Object.fromEntries(commissions.sellers.map((s) => [s.id, String(s.pct)])));
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDefaultPct(commissions.default_pct == null ? "" : String(commissions.default_pct));
    setPcts(Object.fromEntries(commissions.sellers.map((s) => [s.id, String(s.pct)])));
  }, [commissions]);

  const dirty = commissions.sellers.filter((s) => String(s.pct) !== String(pcts[s.id] ?? s.pct));
  const defaultDirty = String(commissions.default_pct ?? "") !== String(defaultPct);
  const earnedOf = useMemo(() => new Map(earned.map((e) => [e.seller_code, e])), [earned]);
  const storeOf = (id) => stores.find((s) => s.id === id);
  const list = commissions.sellers
    .filter((s) => showInactive || s.active)
    .filter((s) => !q || norm(`${s.name} ${s.code}`).includes(norm(q)));
  const inactive = commissions.sellers.filter((s) => !s.active).length;

  const submit = async (e) => {
    e?.preventDefault();
    if (busy || (!dirty.length && !defaultDirty)) return;
    setBusy(true);
    try {
      await saveCommissions({
        ...(defaultDirty ? { defaultPct } : {}),
        ...(dirty.length ? { sellers: dirty.map((s) => ({ id: s.id, pct: pcts[s.id] })) } : {}),
      });
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="fin-comm" onSubmit={submit}>
      <div className="fin-comm-bar">
        <label className="fin-comm-def" htmlFor="fin-comm-default">
          <span>{t("adm.fin.comm.default")}<HelpTip topic="fin.defaultCommission" /></span>
          <input id="fin-comm-default" className="fin-in num" type="number" step="0.01" min="0" max="100" value={defaultPct} placeholder="—" onChange={(e) => setDefaultPct(e.target.value)} />
          <span className="fin-unit">%</span>
        </label>
        <small className="muted fin-comm-hint">{t("adm.fin.comm.defaultHint")}</small>
        {commissions.sellers.length > 8 && (
          <input className="fin-in fin-comm-q" type="search" value={q} placeholder={t("adm.fin.comm.search")} aria-label={t("adm.fin.comm.search")} onChange={(e) => setQ(e.target.value)} />
        )}
        {inactive > 0 && (
          <label className="fin-check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> {t("adm.fin.comm.showInactive", { n: inactive })}</label>
        )}
        <button className="btn-xs primary" disabled={busy || (!dirty.length && !defaultDirty)}>
          <Icon name="save" size={12} /> {dirty.length + (defaultDirty ? 1 : 0) ? t("adm.fin.comm.saveN", { n: dirty.length + (defaultDirty ? 1 : 0) }) : t("adm.fin.save")}
        </button>
      </div>
      <div className="fin-comm-grid" role="list">
        {list.map((s) => {
          const st = storeOf(s.establishment_id);
          const got = earnedOf.get(s.code);
          const changed = String(s.pct) !== String(pcts[s.id] ?? s.pct);
          return (
            <div key={s.id} role="listitem" className={`fin-chip-s ${s.active ? "" : "is-off"} ${changed ? "is-dirty" : ""}`} title={got ? t("adm.fin.comm.earned", { amount: money(got.commission, "usd", lang), net: money(got.net_sales, "usd", lang) }) : undefined}>
              <span className="fin-chip-n">
                {st && <span className="fin-dot" style={{ background: st.color || "var(--adm-muted)" }} aria-hidden="true" />}
                <b>{s.name}</b>
                <small>{s.code}{st ? ` · ${st.code}` : ""}{!s.active ? ` · ${t("adm.fin.comm.inactive")}` : ""}</small>
              </span>
              <span className="fin-chip-v">
                <input className="fin-in num" type="number" step="0.01" min="0" max="100" aria-label={`${t("adm.fin.comm.pct")} · ${s.name}`} value={pcts[s.id] ?? ""}
                  onChange={(e) => setPcts((p) => ({ ...p, [s.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Escape") setPcts((p) => ({ ...p, [s.id]: String(s.pct) })); }} />
                <span className="fin-unit">%</span>
              </span>
              {got && <span className="fin-chip-e">{money(got.commission, "usd", lang)}</span>}
            </div>
          );
        })}
        {!list.length && <p className="fin-empty">{t("adm.fin.comm.empty")}</p>}
      </div>
    </form>
  );
}
