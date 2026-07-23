import React, { useEffect, useState } from "react";
import { shipping, subscribe } from "../admin/priceStore.js";

const money = (n) => "$" + (Number(n) || 0).toFixed(2);

export default function ShippingEstimator({ subtotal = 0, onChange }) {
  const [cfg, setCfg] = useState(() => shipping());
  const pickupOn = !!(cfg.pickup && cfg.pickup.enabled);
  const [method, setMethod] = useState(pickupOn ? "pickup" : "ship");
  const zones = cfg.zones || [];
  const [zoneId, setZoneId] = useState(zones.length ? zones[0].id : "");

  // Re-read config live when the owner changes shipping settings.
  useEffect(() => subscribe(() => setCfg(shipping())), []);

  // If pickup gets disabled while selected, fall back to shipping.
  useEffect(() => {
    if (!pickupOn && method === "pickup") setMethod("ship");
  }, [pickupOn, method]);

  const zone = zones.find((z) => z.id === zoneId) || zones[0];
  const isFree = zone && zone.id === "us" && subtotal >= (cfg.freeThreshold || 0);

  // Notify parent on any change to the selection.
  useEffect(() => {
    if (typeof onChange !== "function") return;
    if (method === "pickup") {
      onChange({ method: "pickup", zoneId: null, carrier: null, cost: 0, etaMin: 0, etaMax: 0 });
    } else if (zone) {
      onChange({
        method: "ship",
        zoneId: zone.id,
        carrier: zone.carrier,
        cost: isFree ? 0 : Number(zone.cost) || 0,
        etaMin: zone.etaMin,
        etaMax: zone.etaMax,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, zoneId, isFree, cfg]);

  return (
    <section className="ship-est" aria-label="Opciones de envío">
      <div className="ship-est-head">
        <span className="ship-est-ico" aria-hidden="true">🚚</span>
        <h3 className="ship-est-title">¿Cómo lo quieres recibir?</h3>
      </div>

      <div className="ship-methods" role="radiogroup" aria-label="Método de entrega">
        {pickupOn && (
          <button
            type="button"
            role="radio"
            aria-checked={method === "pickup"}
            className={"ship-method" + (method === "pickup" ? " on" : "")}
            onClick={() => setMethod("pickup")}
          >
            <div className="ship-method-top">
              <span className="ship-method-ico" aria-hidden="true">🏬</span>
              <span className="ship-method-name">Recoger en tienda</span>
              <span className="ship-badge">Gratis</span>
            </div>
            {method === "pickup" && (
              <div className="ship-method-body">
                <div className="ship-store">{cfg.pickup.name}</div>
                <div className="ship-line">
                  <span aria-hidden="true">📍</span> {cfg.pickup.address} · {cfg.pickup.city}
                </div>
                <div className="ship-line">
                  <span aria-hidden="true">🕒</span> {cfg.pickup.hours}
                </div>
                <a
                  className="ship-maps"
                  href={cfg.pickup.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span aria-hidden="true">📍</span> Cómo llegar
                </a>
              </div>
            )}
          </button>
        )}

        <button
          type="button"
          role="radio"
          aria-checked={method === "ship"}
          className={"ship-method" + (method === "ship" ? " on" : "")}
          onClick={() => setMethod("ship")}
        >
          <div className="ship-method-top">
            <span className="ship-method-ico" aria-hidden="true">🚚</span>
            <span className="ship-method-name">Envío a domicilio</span>
          </div>
          {method === "ship" && (
            <div className="ship-method-body" onClick={(e) => e.stopPropagation()}>
              <select
                className="ship-zone"
                aria-label="Elige tu destino"
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
              {zone && (
                <>
                  <div className="ship-summary">
                    <span className="ship-chip"><span aria-hidden="true">🏷️</span> {zone.carrier}</span>
                    <span className="ship-chip">
                      <span aria-hidden="true">💵</span> {isFree ? "Gratis" : money(zone.cost)}
                    </span>
                    <span className="ship-chip">
                      <span aria-hidden="true">⏱️</span> {zone.etaMin}–{zone.etaMax} días
                    </span>
                  </div>
                  <div className="ship-origin muted">
                    <span aria-hidden="true">📦</span> Enviado desde {cfg.origin ? cfg.origin.city : ""}
                  </div>
                </>
              )}
            </div>
          )}
        </button>
      </div>
    </section>
  );
}
