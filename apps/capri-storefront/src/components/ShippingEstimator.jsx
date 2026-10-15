import React, { useEffect, useState } from "react";
import { shipping, subscribe } from "../admin/priceStore.js";
import { useLang } from "../i18n/LanguageContext.jsx";

const money = (n) => "$" + (Number(n) || 0).toFixed(2);

export default function ShippingEstimator({ subtotal = 0, onChange }) {
  const { t, tv } = useLang();
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
  // Fabricación en el laboratorio: va ANTES de recoger o de enviar, así que se
  // muestra aparte del tránsito del transportista.
  const labDays = Number(cfg.labDays) || 0;

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
    <section className="ship-est" aria-label={t("ship.aria")}>
      <div className="ship-est-head">
        <span className="ship-est-ico" aria-hidden="true">🚚</span>
        <h3 className="ship-est-title">{t("ship.how")}</h3>
      </div>

      <div className="ship-methods" role="radiogroup" aria-label={t("ship.methodAria")}>
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
              <span className="ship-method-name">{t("ship.pickup")}</span>
              <span className="ship-badge">{t("ship.free")}</span>
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
                {labDays > 0 && (
                  <div className="ship-line">
                    <span aria-hidden="true">🔬</span> {t("ship.labPickup", { days: labDays })}
                  </div>
                )}
                <a
                  className="ship-maps"
                  href={cfg.pickup.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span aria-hidden="true">📍</span> {t("ship.directions")}
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
            <span className="ship-method-name">{t("ship.toHome")}</span>
          </div>
          {method === "ship" && (
            <div className="ship-method-body" onClick={(e) => e.stopPropagation()}>
              <select
                className="ship-zone"
                aria-label={t("ship.chooseDest")}
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{tv(z.name)}</option>
                ))}
              </select>
              {zone && (
                <>
                  <div className="ship-summary">
                    <span className="ship-chip"><span aria-hidden="true">🏷️</span> {zone.carrier}</span>
                    <span className="ship-chip">
                      <span aria-hidden="true">💵</span> {isFree ? t("ship.free") : money(zone.cost)}
                    </span>
                    <span className="ship-chip">
                      <span aria-hidden="true">⏱️</span> {zone.etaMin}–{zone.etaMax} {t("ship.days")}
                    </span>
                  </div>
                  {labDays > 0 && (
                    <div className="ship-origin muted">
                      <span aria-hidden="true">🔬</span> {t("ship.labShip", { days: labDays })}
                    </div>
                  )}
                  <div className="ship-origin muted">
                    <span aria-hidden="true">📦</span> {t("ship.shippedFrom")} {cfg.origin ? cfg.origin.city : ""}
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
