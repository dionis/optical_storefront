import React from "react";
import { useLang } from "../i18n/LanguageContext.jsx";

const STEPS = [
  { key: "confirmed", icon: "🧾", label: "track.confirmed" },
  { key: "processing", icon: "📦", label: "track.processing" },
  { key: "shipped", icon: "🏷️", label: "track.shipped" },
  { key: "in_transit", icon: "🚚", label: "track.in_transit" },
  { key: "delivered", icon: "✅", label: "track.delivered" },
];

const INDEX = {
  confirmed: 0,
  processing: 1,
  shipped: 2,
  in_transit: 3,
  delivered: 4,
};

export default function TrackingTimeline({ status = "processing", eta }) {
  const { t } = useLang();
  const current = INDEX[status] != null ? INDEX[status] : 1;
  const fillPct = (current / (STEPS.length - 1)) * 100;

  return (
    <div className="track-wrap" aria-label={t("track.aria")}>
      <div className="track-tl" role="list">
        <div className="track-line" aria-hidden="true">
          <div className="fill" style={{ width: fillPct + "%" }} />
        </div>
        {STEPS.map((s, i) => {
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
              <div className="track-label">{t(s.label)}</div>
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
