// Dónde se usa: Ejecutivo → «Pedidos por etapa» (Executive.jsx) y cualquier
// pantalla que reparta un total en etapas o estados (ventas por estado, caja
// por motivo…). UNA fila: un tile clicable por etapa (icono, nombre, cantidad
// grande, importe pequeño y % del total) y, debajo, una barra apilada con los
// tramos proporcionales a la cantidad en tintes suaves del acento. 64–72 px de
// alto en escritorio. Exporta CSV / Excel / PDF por el ExportMenu de la tarjeta.
//
//   <StageBarCard icon="layers" title=… hint=… name="etapas" onGo={() => go("orders")} goLabel=…
//     stages={[{ key: "in_lab", label: "En laboratorio", icon: "lab", count: 12, amount: 1840 }]}
//     onPick={(stage) => go("orders", { stage: stage.key })} lang={lang} />
//
//   <StageBar stages onPick active lang />   // solo la tira, sin tarjeta
//
// stages: [{ key, label, icon?, count, amount?, tint? }] — `tint` es un color
// CSS opcional; si falta, el tramo i recibe el acento mezclado con la superficie
// (claro → fuerte) para que el conjunto se lea como una progresión, no un arcoíris.
import { useMemo, useRef } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { ExportMenu, InfoTip } from "./ui.jsx";
import { STAGES, STAGE_BY_KEY, TERMINAL_BY_KEY, money as fmtMoney } from "./adminOrders.js";
import "./fit.css";
import "./exec.css";

/* ── Vocabulario de etapas compartido por la lista (StoreOrders), la ficha
   (SaleDetailPanel) y las tarjetas: icono, nombre, orden y «siguiente». ── */

/** Icono de cada etapa / estado terminal (mismo juego en toda la cabina; nunca emojis). */
export const STAGE_ICON = { confirmed: "receipt", in_lab: "lab", shipped: "box", in_transit: "truck", delivered: "checkCircle", payment_pending: "clock", canceled: "alert", refunded: "undo", voided: "undo", pending: "lab", none: "clock" };
/** Posición de cada etapa en la línea (confirmed 0 … delivered 4). */
export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

/** Nombre de una etapa, un terminal, «pending» (grupo), «voided» o null (sin etapa). */
export function stageLabel(stage, t) {
  if (stage === "voided") return t("adm.ex.stg.voidedOne");
  if (stage === "pending") return t("adm.ex.stg.pending");
  if (TERMINAL_BY_KEY[stage]) return t(TERMINAL_BY_KEY[stage].label);
  if (!stage) return t("adm.ex.stg.unknown");
  return STAGE_BY_KEY[stage] ? t(STAGE_BY_KEY[stage].label) : stage;
}

/** La etapa siguiente «natural» entre las que el servidor acepta (`next_stages`): la más cercana hacia delante. */
export function nextForward(b) {
  if (!b || !Array.isArray(b.next_stages) || !b.next_stages.length) return null;
  const cur = STAGE_INDEX[b.stage] ?? -1;
  const fw = b.next_stages.filter((s) => (STAGE_INDEX[s] ?? -1) > cur).sort((a, c) => STAGE_INDEX[a] - STAGE_INDEX[c]);
  return fw[0] || null;
}

/** Chip de etapa (lista, ficha, tarjetas): icono + nombre, tono por etapa en claro y oscuro (exec.css .so-stg). */
export function StageChip({ stage, t, small = false, title, className = "" }) {
  const key = stage || "none";
  return (
    <span className={`so-stg ${key} ${small ? "sm" : ""} ${className}`} title={title || (stage ? undefined : t("adm.ex.stg.unknownHint"))}>
      <Icon name={STAGE_ICON[key] || "clock"} size={small ? 11 : 12} />{stageLabel(stage, t)}
    </span>
  );
}

const int = (n, lang) => (Number(n) || 0).toLocaleString(lang === "en" ? "en-US" : "es");
const pct1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
/** Acento mezclado con la superficie: tramo i de k, del 28 % al 88 %. */
const tintFor = (i, k) => `color-mix(in srgb, var(--adm-accent) ${Math.round(28 + (60 * i) / Math.max(1, k - 1))}%, var(--adm-surface))`;

/** Filas normalizadas (con share) y total — también las usa la exportación. */
export function stageRows(stages) {
  const total = stages.reduce((s, x) => s + (Number(x.count) || 0), 0);
  const rows = stages.map((x, i) => ({
    ...x,
    count: Number(x.count) || 0,
    amount: Number(x.amount) || 0,
    share: total ? ((Number(x.count) || 0) / total) * 100 : 0,
    tint: x.tint || tintFor(i, stages.length),
  }));
  return { rows, total, amount: rows.reduce((s, x) => s + x.amount, 0) };
}

export function StageBar({ stages = [], onPick, active, lang: givenLang, currency = "usd", showAmount = true, emptyText }) {
  const { t, lang: ctxLang } = useLang();
  const lang = givenLang || ctxLang;
  const { rows, total } = useMemo(() => stageRows(stages), [stages]);
  if (!rows.length || total === 0) return <div className="stg-empty">{emptyText || t("adm.fit.stage.empty")}</div>;
  return (
    <div className="stg" role="group" aria-label={t("adm.fit.stage.aria", { n: int(total, lang), k: rows.length })}>
      <div className="stg-tiles">
        {rows.map((r) => (
          <button type="button" key={r.key} className={`stg-tile ${active === r.key ? "is-on" : ""}`} style={{ "--stg-tint": r.tint }}
            onClick={onPick ? () => onPick(r) : undefined} title={t("adm.fit.stage.open", { stage: r.label })}>
            <span className="stg-ico"><Icon name={r.icon || "box"} size={14} /></span>
            <span className="stg-name">{r.label}</span>
            <span className="stg-nums">
              <b className="stg-n">{int(r.count, lang)}</b>
              {showAmount && <span className="stg-v">{fmtMoney(r.amount, currency, lang)}</span>}
              <span className="stg-pct" title={t("adm.fit.stage.share")}>{pct1(r.share)}%</span>
            </span>
          </button>
        ))}
      </div>
      <div className="stg-bar" aria-hidden="true">
        {rows.map((r) => r.count > 0 && (
          <i key={r.key} className={`stg-seg ${active === r.key ? "is-on" : ""}`} style={{ "--stg-tint": r.tint, flex: `${r.count} 1 0` }} title={`${r.label} · ${int(r.count, lang)} · ${pct1(r.share)}%`} />
        ))}
      </div>
    </div>
  );
}

/** Tarjeta con cabecera accionable + ExportMenu (CSV / Excel / PDF) de las etapas. */
export function StageBarCard({ icon = "layers", title, hint, onGo, goLabel, name = "etapas", className = "", stages = [], currency = "usd", ...rest }) {
  const { t, lang } = useLang();
  const ref = useRef(null);
  const cols = useMemo(() => [
    { header: t("adm.fit.stage.col.stage"), key: "label", width: 24 },
    { header: t("adm.fit.stage.col.count"), key: "count", type: "int", width: 12 },
    { header: t("adm.fit.stage.col.amount"), key: "amount", type: "money", width: 14 },
    { header: t("adm.fit.stage.col.share"), key: "share", type: "pct", width: 12 },
  ], [t]);
  const xlsx = () => {
    const { rows, total, amount } = stageRows(stages);
    return { filename: `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`, sheets: [{ name: t("adm.fit.stage.sheet"), cols, rows, totals: { count: total, amount, share: 100 }, totalsLabel: t("adm.fit.stage.total") }] };
  };
  const csv = { cols: cols.map((c) => [c.header, c.key === "share" ? (r) => pct1(r.share) : c.key]), rows: stageRows(stages).rows };
  return (
    <div className={`adm-card ${onGo ? "has-go" : ""} ${className}`} ref={ref}>
      <div className="adm-card-head">
        <h3 className={onGo ? "go" : ""} onClick={onGo} role={onGo ? "button" : undefined} tabIndex={onGo ? 0 : undefined} title={onGo ? (goLabel || t("adm.ui.open")) : undefined}
          onKeyDown={onGo ? (e) => { if (e.key === "Enter") onGo(e); } : undefined}>
          {icon && <Icon name={icon} size={16} />}{title}
          {onGo && <Icon name="arrowUpRight" size={14} className="adm-go-ico" />}
        </h3>
        <span className="adm-card-tools">
          <InfoTip text={hint} title={title} />
          <ExportMenu targetRef={ref} title={title} csv={csv} xlsx={xlsx} name={name} />
        </span>
      </div>
      <StageBar stages={stages} currency={currency} lang={lang} {...rest} />
    </div>
  );
}

export default StageBar;
