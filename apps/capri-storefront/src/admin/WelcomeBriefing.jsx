// Welcome briefing modal shown on first login of the session. Animates through
// key daily metrics one at a time: weekly sales, commission, orders in lab,
// pending deliveries. Blurred background, professional step-by-step reveal.
import { useCallback, useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { fetchOrders } from "./adminOrders.js";
import { fetchSellerStats } from "./adminSellers.js";

const SESSION_KEY = "adm_briefing_done";

/** ISO date string for N days ago. */
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Format currency with MXN symbol. */
const money = (v) => {
  if (v == null || Number.isNaN(v)) return "$0";
  return "$" + Number(v).toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

/**
 * Load the four daily metrics from existing backend endpoints.
 * Uses the seller_code from `me` to filter personal stats.
 */
async function loadBriefingData(me) {
  const from = daysAgo(7);
  const to = new Date().toISOString().slice(0, 10);
  const [orders, stats] = await Promise.allSettled([
    fetchOrders({ from, to, limit: 200 }),
    fetchSellerStats({ from, to }),
  ]);
  // Count stages from orders.
  const list = orders.status === "fulfilled" ? (orders.value?.orders || []) : [];
  const inLab = list.filter((o) => o.stage === "in_lab").length;
  const pending = list.filter((o) => o.stage === "shipped" || o.stage === "in_transit").length;

  // Find this seller's stats.
  const sellers = stats.status === "fulfilled" ? (stats.value?.sellers || []) : [];
  const code = me?.seller_code;
  const mine = code ? sellers.find((s) => s.seller_code === code) : null;
  // Fallback: if admin/owner, sum all sellers.
  const weeklySales = mine ? (mine.total || 0)
    : me?.is_admin !== false ? sellers.reduce((s, x) => s + (x.total || 0), 0) : 0;
  const commission = mine ? (mine.commission || 0)
    : me?.is_admin !== false ? sellers.reduce((s, x) => s + (x.commission || 0), 0) : 0;

  return { weeklySales, commission, inLab, pending };
}

const STEPS = ["weeklySales", "commission", "inLab", "pendingDelivery"];

export default function WelcomeBriefing({ me, onDone }) {
  const { t } = useLang();
  const [step, setStep] = useState(0);
  const [data, setData] = useState(null);

  useEffect(() => {
    loadBriefingData(me).then(setData).catch(() => setData({}));
  }, [me]);

  const displayName = me?.display_name || me?.first_name || String(me?.email || "").split("@")[0];

  const finish = useCallback(() => {
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* noop */ }
    onDone();
  }, [onDone]);

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  };

  const metricValue = (key) => {
    if (!data) return "…";
    switch (key) {
      case "weeklySales": return money(data.weeklySales);
      case "commission": return money(data.commission);
      case "inLab": return data.inLab ?? 0;
      case "pendingDelivery": return data.pending ?? 0;
      default: return "—";
    }
  };
  const isGold = (key) => key === "commission";

  return (
    <div className="adm-briefing-overlay" role="dialog" aria-modal="true">
      <div className="adm-briefing-card">
        <div className="adm-briefing-avatar">
          {me?.photo_url
            ? <img src={me.photo_url} alt={displayName} />
            : displayName.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?"}
        </div>
        <h2 className="adm-briefing-greeting">
          {t("adm.briefing.greeting").replace("{name}", displayName)}
        </h2>

        <div className="adm-briefing-metric" key={STEPS[step]}>
          <div className="adm-briefing-metric-label">{t(`adm.briefing.${STEPS[step]}`)}</div>
          <div className={`adm-briefing-metric-value${isGold(STEPS[step]) ? " gold" : ""}`}>
            {metricValue(STEPS[step])}
          </div>
        </div>

        <div className="adm-briefing-dots">
          {STEPS.map((_, i) => <span key={i} className={`adm-briefing-dot${i === step ? " on" : i < step ? " done" : ""}`} />)}
        </div>

        <div className="adm-briefing-footer">
          <button type="button" className="btn-sm ghost" onClick={finish}>
            {t("adm.briefing.skip")}
          </button>
          <button type="button" className="btn-sm primary" onClick={next}>
            {step < STEPS.length - 1 ? t("adm.briefing.next") : t("adm.briefing.done")}
            {step < STEPS.length - 1 && <Icon name="chevronRight" size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Returns true if the briefing has already been shown this session. */
export function briefingShown() {
  try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}
