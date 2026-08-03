import React from "react";
import { useLang } from "../i18n/LanguageContext.jsx";

// Mirrors ORDER_STAGES in apps/backend/src/lib/order-status.ts — the backend
// decides which stage an order is in, this only draws it. Keep both in sync.
const STEPS = [
  { key: "confirmed", icon: "🧾", label: "track.confirmed" },
  { key: "in_lab", icon: "🔬", label: "track.in_lab" },
  { key: "shipped", icon: "🏷️", label: "track.shipped" },
  { key: "in_transit", icon: "🚚", label: "track.in_transit" },
  { key: "delivered", icon: "✅", label: "track.delivered" },
];

const INDEX = {
  confirmed: 0,
  in_lab: 1,
  processing: 1, // legacy alias, kept so older stored values still render
  shipped: 2,
  in_transit: 3,
  delivered: 4,
};

// A canceled or refunded order is not "somewhere on the timeline" — drawing it
// as progress would be a lie, so those states replace the timeline entirely.
const TERMINAL_LABEL = {
  canceled: "track.canceled",
  refunded: "track.refunded",
  payment_pending: "track.payment_pending",
};

export default function TrackingTimeline({
  status = "confirmed",
  eta,
  terminal = null,
  hasPrescription = false,
}) {
  const { t } = useLang();
  const current = INDEX[status] != null ? INDEX[status] : 0;
  const fillPct = (current / (STEPS.length - 1)) * 100;

  if (terminal && TERMINAL_LABEL[terminal]) {
    return (
      <div className={`track-terminal ${terminal}`} role="status">
        <span aria-hidden="true">{terminal === "payment_pending" ? "⏳" : "⚠️"}</span>
        <span>{t(TERMINAL_LABEL[terminal])}</span>
      </div>
    );
  }

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
              <div className="track-label">
                {/* Frame-only orders never see a lab, so that step is named for
                    what actually happens to them. */}
                {s.key === "in_lab" && !hasPrescription
                  ? t("track.in_lab_frame")
                  : t(s.label)}
              </div>
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
