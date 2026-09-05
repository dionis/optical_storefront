import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";

// Reporte de medición óptica (estilo "ficha del óptico"): dos vistas — frontal con la
// DIP y lateral con la altura de corredor — más una tira de datos para el laboratorio.
// Es puramente presentacional; el ciclo de la llamada vive en TryOnStudio.

const mm = (v) => (v == null || Number.isNaN(v) ? "—" : `${Math.round(v * 10) / 10} mm`);

// Formulario de "avísame cuando esté listo", ofrecido durante `phase === "loading"`
// una vez que el servicio lleva varios reintentos contra un proveedor saturado (ver
// TryOnStudio: mProgress.slow). Guarda su propio email/whatsapp tecleados — el envío
// real y el resto del ciclo de vida del trabajo siguen viviendo en TryOnStudio.
function SlowNoticeForm({ t, pending, error, onSubmit }) {
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  return (
    <form
      className="vm-slow"
      onSubmit={(e) => { e.preventDefault(); onSubmit(email.trim(), whatsapp.trim()); }}
    >
      <p className="vm-slow-msg">{t("vm.slowBody")}</p>
      <input
        type="email" className="vm-slow-input" autoComplete="off"
        placeholder={t("vm.slowEmailPh")} value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="tel" className="vm-slow-input" autoComplete="off"
        placeholder={t("vm.slowWhatsappPh")} value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
      />
      <button type="submit" className="vm-btn" disabled={pending}>
        {pending ? t("vm.slowSending") : t("vm.slowSubmit")}
      </button>
      {error && <p className="vm-err">{error}</p>}
    </form>
  );
}

// Carrusel COMERCIAL mostrado mientras se calcula: en vez de una espera "muerta", el
// cliente ve mensajes rotativos que lo retienen y venden la óptica (garantía, envío,
// AR, calidad, etc.). Cambia cada ~4 s con un fundido. Los textos vienen del i18n
// (vm.ad1..vm.adN) para quedar 100% bilingües; se auto-ajusta a cuántos existan.
function CommercialCarousel({ t }) {
  const ads = ["vm.ad1", "vm.ad2", "vm.ad3", "vm.ad4", "vm.ad5", "vm.ad6"]
    .map((k) => t(k)).filter((s) => s && !s.startsWith("vm.ad"));
  const [i, setI] = useState(0);
  useEffect(() => {
    if (ads.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % ads.length), 4200);
    return () => clearInterval(id);
  }, [ads.length]);
  if (!ads.length) return null;
  return (
    <div className="vm-ads" aria-live="polite">
      <div className="vm-ad" key={i}>
        <span className="vm-ad-star" aria-hidden="true">✦</span>
        <span>{ads[i % ads.length]}</span>
      </div>
      <div className="vm-ad-dots" aria-hidden="true">
        {ads.map((_, n) => <span key={n} className={n === (i % ads.length) ? "on" : ""} />)}
      </div>
    </div>
  );
}

export default function MeasureReport({
  phase, data, frontFallback, sideFallback, error, errorCode, onRetry, onClose, topOffset = 0,
  slow = false, notifyState = "idle", notifyError = null, onNotifySubmit,
}) {
  const { t } = useLang();

  const body = () => {
    if (phase === "loading") {
      // Guardado el contacto, no queda nada más que este cliente tenga que hacer: el
      // trabajo sigue en el servidor y avisa por su cuenta, así que la confirmación
      // reemplaza al spinner en vez de convivir con él.
      if (notifyState === "armed") {
        return (
          <div className="vm-state">
            <div className="vm-ok-ic" aria-hidden="true">✓</div>
            <p>{t("vm.slowArmed")}</p>
          </div>
        );
      }
      return (
        <div className="vm-state vm-loading">
          <div className="vm-spinner" aria-hidden="true" />
          <p className="vm-calcing">{t("vm.calcing")}</p>
          <CommercialCarousel t={t} />
          <p className="vm-load-note">{t("vm.loadBusy")}</p>
          {slow && (
            <SlowNoticeForm
              t={t}
              pending={notifyState === "pending"}
              error={notifyState === "error" ? (notifyError || t("vm.slowError")) : null}
              onSubmit={onNotifySubmit}
            />
          )}
        </div>
      );
    }
    if (phase === "error") {
      const msg = errorCode === "missing-api-key" ? t("vm.noKey") : (error || t("vm.failed"));
      return (
        <div className="vm-state">
          <div className="vm-err-ic" aria-hidden="true">⚠️</div>
          <p className="vm-err">{msg}</p>
          <button className="vm-btn" onClick={onRetry}>{t("vm.retry")}</button>
        </div>
      );
    }
    // result
    const front = data?.frontImage || frontFallback;
    const side = data?.profileImage || sideFallback;
    const suit = data?.suitable;
    return (
      <>
        <div className="vm-views">
          <figure className="vm-view">
            <figcaption className="vm-vlabel">{t("vm.front")}</figcaption>
            {front ? <img src={front} alt={t("vm.front")} /> : <div className="vm-noimg">📷</div>}
            <div className="vm-badge">
              <span className="vm-blab">{t("vm.pd")}</span>
              <span className="vm-bval">{mm(data?.pd)}</span>
              {(data?.pdRight != null || data?.pdLeft != null) && (
                <span className="vm-bsub">OD {mm(data?.pdRight)} · OS {mm(data?.pdLeft)}</span>
              )}
            </div>
          </figure>

          <figure className="vm-view">
            <figcaption className="vm-vlabel">{t("vm.side")}</figcaption>
            {side ? <img src={side} alt={t("vm.side")} /> : <div className="vm-noimg">📷</div>}
            <div className="vm-badge">
              <span className="vm-blab">{t("vm.corridor")}</span>
              <span className="vm-bval">{mm(data?.corridor)}</span>
              <span className="vm-bsub vm-note">{t("vm.corridorNote")}</span>
            </div>
          </figure>
        </div>

        <div className="vm-facts">
          <div className="vm-fact"><span>{t("vm.progressive")}</span><b>{mm(data?.progressive ?? data?.corridor)}</b></div>
          <div className="vm-fact"><span>{t("vm.bifocal")}</span><b>{mm(data?.bifocal)}</b></div>
          {suit != null && (
            <div className={`vm-suit ${suit ? "ok" : "no"}`}>
              {suit ? "✓ " + t("vm.suitOk") : "✕ " + t("vm.suitNo")}
            </div>
          )}
        </div>

        {Array.isArray(data?.warnings) && data.warnings.length > 0 && (
          <ul className="vm-warns">{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        )}
        {!side && <p className="vm-aiprofile">{t("vm.aiProfileNote")}</p>}
        <p className="vm-disc">{t("vm.disclaimer")}</p>
      </>
    );
  };

  return createPortal(
    <div className="vm-overlay" role="dialog" aria-modal="true" style={{ top: topOffset || 0 }}>
      <div className="vm-bar">
        <span className="vm-title">📐 {t("vm.title")}</span>
        <button className="vm-x" onClick={onClose} aria-label={t("tryon.close")}>×</button>
      </div>
      <div className="vm-body">{body()}</div>
    </div>,
    document.body
  );
}
