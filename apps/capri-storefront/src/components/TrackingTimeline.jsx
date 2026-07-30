import React from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { ORDER_STATUS, orderStatusIndex } from "../data/orderStatus.js";

// ─────────────────────────────────────────────────────────────────────────
// TrackingTimeline — línea de tiempo del seguimiento que ve el CLIENTE.
//
// Los pasos y sus etiquetas salen del modelo compartido `orderStatus.js`, así
// que SIEMPRE coinciden con lo que el admin puede fijar en su panel (mismo
// vocabulario en ambos lados). Las etiquetas son bilingües desde el módulo.
// ─────────────────────────────────────────────────────────────────────────
export default function TrackingTimeline({ status = ORDER_STATUS[0].key, eta }) {
  const { t, lang } = useLang();
  const current = orderStatusIndex(status);               // 0..n-1 (nunca -1)
  const fillPct = (current / (ORDER_STATUS.length - 1)) * 100;

  return (
    <div className="track-wrap" aria-label={t("track.aria")}>
      <div className="track-tl" role="list">
        <div className="track-line" aria-hidden="true">
          <div className="fill" style={{ width: fillPct + "%" }} />
        </div>
        {ORDER_STATUS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "done active" : "todo";
          const isCurrent = i === current;
          return (
            <div
              key={s.key}
              className={"track-node " + state}
              role="listitem"
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="track-circle" aria-hidden="true">
                <span className="track-ico">{s.icon}</span>
              </div>
              <div className="track-label">{lang === "en" ? s.en : s.es}</div>
            </div>
          );
        })}
      </div>
      {eta && (
        <div className="track-eta muted">
          <span aria-hidden="true">⏱️</span> {t("track.eta")} {eta}
        </div>
      )}
    </div>
  );
}
