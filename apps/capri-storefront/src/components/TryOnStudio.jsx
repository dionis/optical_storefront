import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";

// Interfaz de CLIENTE del probador (producción).
//
// Espejo (cámara) a la izquierda — NO dibuja el marco sobre la cara — y a la
// derecha la ficha profesional del marco: cabecera, datos + foto y una tira de
// medidas con iconografía óptica (ancho de lente · puente · largo de varilla).
// El respaldo TryOn.jsx (motor 3D + calibración) queda intacto (ver README).

/* ── Iconografía óptica profesional (line-art, hereda color con currentColor) ── */

// ANCHO DE LENTE — gafas de frente: dos lentes + puente + patillas
function IconLensWidth(props) {
  return (
    <svg viewBox="0 0 76 40" fill="none" stroke="currentColor" strokeWidth="2.4"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="7" y="10" width="27" height="22" rx="9" />
      <rect x="42" y="10" width="27" height="22" rx="9" />
      <path d="M34 16 c3 -3 5 -3 8 0" />
      <path d="M7 16 L1 12" />
      <path d="M69 16 L75 12" />
    </svg>
  );
}

// PUENTE — bordes internos de ambas lentes + puente nasal (trazo continuo)
function IconBridge(props) {
  return (
    <svg viewBox="0 0 76 40" fill="none" stroke="currentColor" strokeWidth="2.4"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 33 C12 15 20 13 29 13 C33 13 34 9 38 9 C42 9 43 13 47 13 C56 13 64 15 64 33" />
    </svg>
  );
}

// LARGO DE VARILLA — patilla de perfil: bisagra + brazo + curva tras la oreja
function IconTemple(props) {
  return (
    <svg viewBox="0 0 76 40" fill="none" stroke="currentColor" strokeWidth="2.4"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="11" cy="17" r="3.4" />
      <path d="M15 17 L55 17 C68 17 70 22 66 36" />
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

  // Los valores del catálogo llegan como texto con unidad y a menudo en rango
  // ("51-53 mm", "Más de 60 mm"). Sólo añadimos " mm" a números puros.
  const fmt = (v) => {
    if (v == null || v === "") return null;
    const s = String(v).trim();
    if (!s) return null;
    return /^[\d.,\s]+$/.test(s) ? `${s} mm` : s;
  };
  const eye = a.eye_size, bridge = a.bridge_size, temple = a.temple_length;
  const eyeD = fmt(eye), bridgeD = fmt(bridge), templeD = fmt(temple);

  const materials = Array.isArray(a.material) ? a.material : (a.material ? [a.material] : []);
  const materialText = materials.length
    ? materials.map((m) => tv(String(m))).join(` ${t("fs.and")} `)
    : null;
  const shapeText = a.shape ? tv(a.shape) : null;
  const na = t("fs.na");

  const cells = [
    { key: "eye", label: t("fs.lensWidth"), value: eyeD, Icon: IconLensWidth },
    { key: "bridge", label: t("fs.bridge"), value: bridgeD, Icon: IconBridge },
    { key: "temple", label: t("fs.temple"), value: templeD, Icon: IconTemple },
  ];

  const specRows = [
    { key: "model", label: t("fs.model"),
      node: (<>{product.name}{product.brand ? <span className="fs-sub"> ({product.brand})</span> : null}</>) },
    { key: "color", label: t("fs.color"), node: color?.name || na },
    materialText && { key: "material", label: t("fs.material"), node: materialText },
    shapeText && { key: "shape", label: t("fs.shape"), node: shapeText },
  ].filter(Boolean);

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

        {/* Derecha: ficha profesional del marco ("Información de la montura") */}
        <aside className="fs-card">
          <div className="fs-hd"><IconLensWidth className="fs-hd-ic" />{t("fs.frameInfo")}</div>

          <div className="fs-top">
            <dl className="fs-specs">
              {specRows.map((r) => (
                <div className="fs-row" key={r.key}>
                  <dt>{r.label}</dt>
                  <dd>{r.node}</dd>
                </div>
              ))}
            </dl>
            <div className="fs-photo">
              {color?.image
                ? <img src={color.image} alt={`${product.name} ${color?.name || ""}`}
                       onError={(e) => { e.currentTarget.style.opacity = 0.2; }} />
                : <div className="fs-photo-ph" aria-hidden="true">👓</div>}
            </div>
          </div>

          {colors.length > 1 && (
            <div className="fs-swatches" role="listbox" aria-label={product.name}>
              {colors.map((c, i) => (
                <button key={c.name + i} type="button" role="option" aria-selected={i === ci}
                        className={`fs-sw ${i === ci ? "on" : ""}`} style={{ background: c.hex || "#ccc" }}
                        title={c.name} aria-label={c.name} onClick={() => setCi(i)} />
              ))}
            </div>
          )}

          <div className="fs-measures">
            <div className="fs-mhead">
              {cells.map((c) => <span key={c.key}>{c.label}</span>)}
            </div>
            <div className="fs-mbody">
              {cells.map(({ key, value, Icon }) => (
                <div className="fs-mcell" key={key}>
                  <Icon className="fs-mic" />
                  <b className="fs-mval">{value || "—"}</b>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>,
    document.body
  );
}
