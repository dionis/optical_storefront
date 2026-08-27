import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { frameSize } from "../data/frameSpecLabels.js";

// Interfaz de CLIENTE del probador (producción).
//
// Nace de TryOn.jsx pero cambia el enfoque a petición: NO dibuja el espejuelo
// sobre la cara. Muestra un ESPEJO (cámara) a la izquierda y, a la derecha, la
// ficha del marco seleccionado: foto, diagrama profesional de medidas y
// materiales. El respaldo TryOn.jsx (motor 3D + calibración) queda intacto y
// accesible por el switch (ver TryOnSwitch.jsx / README).

// Diagrama frontal del marco con las cotas principales (calibre, puente, altura).
function FrameDiagram({ eye, bridge, height, t }) {
  const val = (v) => (v == null || v === "" ? "—" : `${v}`);
  return (
    <svg className="tsi-diagram" viewBox="0 0 340 190" role="img"
         aria-label={t("tryon.studio.specsTitle")}>
      <defs>
        <marker id="tsiArrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#2f74ff" />
        </marker>
      </defs>
      {/* Varillas (stubs) */}
      <path d="M40 70 L14 62" className="tsi-frame-line" />
      <path d="M300 70 L326 62" className="tsi-frame-line" />
      {/* Lentes */}
      <rect x="40" y="46" width="108" height="78" rx="26" className="tsi-lens" />
      <rect x="192" y="46" width="108" height="78" rx="26" className="tsi-lens" />
      {/* Puente */}
      <path d="M148 66 q22 -14 44 0" className="tsi-frame-line" />

      {/* Cota CALIBRE (ancho de lente) — bajo la lente izquierda */}
      <line x1="40" y1="150" x2="148" y2="150" className="tsi-dim" markerStart="url(#tsiArrow)" markerEnd="url(#tsiArrow)" />
      <line x1="40" y1="124" x2="40" y2="156" className="tsi-tick" />
      <line x1="148" y1="124" x2="148" y2="156" className="tsi-tick" />
      <text x="94" y="168" className="tsi-dim-txt" textAnchor="middle">{t("tryon.m.eye")} {val(eye)}</text>

      {/* Cota PUENTE — arriba, entre lentes */}
      <line x1="148" y1="30" x2="192" y2="30" className="tsi-dim" markerStart="url(#tsiArrow)" markerEnd="url(#tsiArrow)" />
      <line x1="148" y1="30" x2="148" y2="52" className="tsi-tick" />
      <line x1="192" y1="30" x2="192" y2="52" className="tsi-tick" />
      <text x="170" y="22" className="tsi-dim-txt" textAnchor="middle">{t("tryon.m.bridge")} {val(bridge)}</text>

      {/* Cota ALTURA — sólo si el catálogo trae el dato */}
      {height != null && height !== "" && (
        <>
          <line x1="316" y1="46" x2="316" y2="124" className="tsi-dim" markerStart="url(#tsiArrow)" markerEnd="url(#tsiArrow)" />
          <line x1="300" y1="46" x2="322" y2="46" className="tsi-tick" />
          <line x1="300" y1="124" x2="322" y2="124" className="tsi-tick" />
          <text x="316" y="90" className="tsi-dim-txt" textAnchor="middle" transform="rotate(90 316 90)">{t("tryon.m.height")} {val(height)}</text>
        </>
      )}
    </svg>
  );
}

export default function TryOnStudio({ product, colorIdx = 0, onClose }) {
  const { t, tv } = useLang();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ci, setCi] = useState(colorIdx);
  const [status, setStatus] = useState("starting"); // starting | ready | denied | nocam

  const colors = product?.colors || [];
  const color = colors[ci] || colors[0] || null;
  const a = product?.attributes || {};

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus("nocam"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("ready");
      } catch (e) {
        const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
        setStatus(denied ? "denied" : "nocam");
      }
    }
    start();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((tr) => tr.stop()); };
  }, []);

  // Los valores del catálogo ya vienen como texto con unidad y a menudo como
  // rango ("51-53 mm", "Más de 60 mm"). Sólo añadimos " mm" a números puros;
  // así evitamos duplicar la unidad y respetamos los rangos tal cual.
  const fmt = (v) => {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    if (!s) return null;
    return /^[\d.,\s]+$/.test(s) ? `${s} mm` : s;
  };
  const eye = a.eye_size, bridge = a.bridge_size, temple = a.temple_length;
  const height = a.b_measurement ?? a.lens_height ?? null;
  const eyeD = fmt(eye), bridgeD = fmt(bridge), templeD = fmt(temple), heightD = fmt(height);
  // El código compacto "52□18-140" sólo es legible con números puros; si el
  // catálogo trae rangos con unidad ("51-53 mm"), no lo mostramos.
  const rawCode = frameSize(a);
  const cleanCode = rawCode && /^\d+\s*□\s*\d+-\d+$/.test(rawCode) ? rawCode : null;
  const materials = Array.isArray(a.material) ? a.material : (a.material ? [a.material] : []);

  const measures = [
    { key: "eye", label: t("tryon.m.eye"), value: eyeD },
    { key: "bridge", label: t("tryon.m.bridge"), value: bridgeD },
    { key: "temple", label: t("tryon.m.temple"), value: templeD },
    { key: "height", label: t("tryon.m.height"), value: heightD },
  ].filter((m) => m.value);

  return createPortal(
    <div className="tryon tryon-studio" role="dialog" aria-modal="true">
      <div className="tryon-bar">
        <span className="tryon-title">👓 {t("tryon.title")} · {product.name}</span>
        <button className="tryon-x" onClick={onClose} aria-label={t("tryon.close")}>×</button>
      </div>

      <div className="tryon-studio-grid">
        {/* Izquierda: espejo (cámara, sin dibujar el marco) */}
        <div className="tryon-studio-cam">
          <video ref={videoRef} className="tryon-video" playsInline muted />
          {status !== "ready" && (
            <div className="tryon-overlay-msg">
              {status === "starting" && <p>📷 {t("tryon.starting")}</p>}
              {status === "denied" && <p>🚫 {t("tryon.denied")}</p>}
              {status === "nocam" && <p>😕 {t("tryon.noCam")}</p>}
            </div>
          )}
        </div>

        {/* Derecha: ficha del marco seleccionado */}
        <aside className="tryon-studio-info">
          <div className="tsi-photo">
            {color?.image
              ? <img src={color.image} alt={`${product.name} ${color?.name || ""}`}
                     onError={(e) => { e.currentTarget.style.opacity = 0.25; }} />
              : <div className="tsi-photo-ph" aria-hidden>👓</div>}
          </div>

          <div className="tsi-head">
            <div className="tsi-brand">{product.brand}</div>
            <div className="tsi-name">{product.name}</div>
            {a.shape && <div className="tsi-shape">{tv(a.shape)}</div>}
          </div>

          {colors.length > 1 && (
            <div className="tsi-swatches" role="listbox" aria-label={product.name}>
              {colors.map((c, i) => (
                <button key={c.name} type="button" role="option" aria-selected={i === ci}
                        className={`tsi-sw ${i === ci ? "on" : ""}`} style={{ background: c.hex || "#ccc" }}
                        title={c.name} aria-label={c.name} onClick={() => setCi(i)} />
              ))}
            </div>
          )}

          {(measures.length > 0 || cleanCode) && (
            <div className="tsi-block">
              <h4 className="tsi-h">
                {t("tryon.studio.specsTitle")}
                {cleanCode && <span className="tsi-code">{cleanCode}</span>}
              </h4>
              <FrameDiagram eye={eyeD} bridge={bridgeD} height={heightD} t={t} />
              {measures.length > 0 && (
                <ul className="tsi-measures">
                  {measures.map((m) => (
                    <li key={m.key}><span>{m.label}</span><b>{m.value}</b></li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {materials.length > 0 && (
            <div className="tsi-block">
              <h4 className="tsi-h">{t("tryon.studio.materialsTitle")}</h4>
              <div className="tsi-mats">
                {materials.map((m, i) => (
                  <span key={i} className="tsi-mat">
                    <svg className="tsi-mat-ic" viewBox="0 0 24 24" aria-hidden><path d="M4 7h16M4 12h16M4 17h10" /></svg>
                    {tv(String(m))}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>,
    document.body
  );
}
