import React from "react";

const STEPS = [
  { key: "confirmed", icon: "🧾", label: "Confirmado" },
  { key: "processing", icon: "📦", label: "En preparación" },
  { key: "shipped", icon: "🏷️", label: "Enviado" },
  { key: "in_transit", icon: "🚚", label: "En camino" },
  { key: "delivered", icon: "✅", label: "Entregado" },
];

const INDEX = {
  confirmed: 0,
  processing: 1,
  shipped: 2,
  in_transit: 3,
  delivered: 4,
};

export default function TrackingTimeline({ status = "processing", eta }) {
  const current = INDEX[status] != null ? INDEX[status] : 1;
  const fillPct = (current / (STEPS.length - 1)) * 100;

  return (
    <div className="track-wrap" aria-label="Estado del pedido">
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
              <div className="track-label">{s.label}</div>
            </div>
          );
        })}
      </div>
      {eta && (
        <div className="track-eta muted">
          <span aria-hidden="true">⏱️</span> Entrega estimada: {eta}
        </div>
      )}
    </div>
  );
}
