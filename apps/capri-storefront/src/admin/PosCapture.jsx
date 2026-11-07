// Dónde se usa: Nueva venta (PosSale.jsx) — foto de la receta para leerla con
// IA (paso Receta) y foto de la montura que trae el cliente (paso Montura).
// Pensado para la tablet del mostrador (iPad / Galaxy Tab):
//   · «Tomar foto»: <input capture="environment"> abre directamente la cámara
//     trasera en iOS Safari y Android Chrome;
//   · «Elegir de la galería»: el mismo input SIN capture, que ofrece fotos
//     guardadas (y en iOS también la cámara y Archivos);
//   · en un ordenador (puntero fino) `capture` no abre cámara: solo se muestra
//     el botón de archivo, con el texto de siempre.
// Tras elegir, vista previa con «Repetir foto». La reducción de tamaño antes de
// subir la hacen los caminos de siempre (posApi.js → lib/imagePrep.js
// preparePrescriptionFile): aquí no se toca el archivo, solo se enseña.
import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";

/** Móvil o tablet: en un ordenador `capture` no abre la cámara, solo repetiría el selector de archivos. */
export const hasTouchCamera = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;

/**
 * - `onFile(file)`: el archivo elegido (cámara, galería o archivo).
 * - `accept`: tipos del selector de galería/archivo (la cámara siempre es image/*).
 * - `preview`: URL ya preparada para enseñar (p. ej. el data URL de la montura);
 *   si no viene, se enseña la imagen elegida con un object URL (la receta).
 * - `cameraLabel` / `fileLabel`: textos de los botones en escritorio y para la
 *   cámara; en táctil el segundo botón dice «Elegir de la galería».
 * - `busy`: desactiva los botones (p. ej. mientras se lee la receta) con `busyLabel`.
 * - `onClear`: si viene, la vista previa lleva «Quitar».
 */
export default function PosCapture({ onFile, accept = "image/*", preview = null, cameraLabel, fileLabel, busy = false, busyLabel, onClear, previewAlt, className = "" }) {
  const { t } = useLang();
  const touch = hasTouchCamera();
  const camRef = useRef(null);
  const [local, setLocal] = useState(null); // { url, name, pdf }

  // El object URL de la vista previa se libera al cambiar o al desmontar.
  useEffect(() => () => { if (local?.url) URL.revokeObjectURL(local.url); }, [local]);

  const pick = (e) => {
    const f = e.target.files?.[0];
    // Sin esto, volver a elegir el mismo archivo no dispara onChange.
    e.target.value = "";
    if (!f) return;
    if (!preview) {
      const pdf = f.type === "application/pdf";
      setLocal({ url: pdf ? null : URL.createObjectURL(f), name: f.name, pdf });
    }
    onFile(f);
  };
  const clear = () => { setLocal(null); onClear?.(); };
  const shown = preview || local?.url || null;
  const label = (txt) => (busy && busyLabel ? busyLabel : txt);

  return (
    <div className={`pos-cap ${shown || local ? "has-preview" : ""} ${className}`.trim()}>
      <div className="pos-cap-btns">
        {touch && (
          <label className={`pos-file pos-cap-btn primary ${busy ? "is-busy" : ""}`}>
            <Icon name="camera" size={18} /> {label(cameraLabel || t("adm.pos.cap.camera"))}
            <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={pick} disabled={busy} />
          </label>
        )}
        <label className={`pos-file pos-cap-btn ${busy ? "is-busy" : ""}`}>
          <Icon name={touch ? "image" : "upload"} size={18} /> {label(touch ? t("adm.pos.cap.gallery") : fileLabel)}
          <input type="file" accept={accept} onChange={pick} disabled={busy} />
        </label>
      </div>
      {(shown || local?.pdf) && (
        <figure className="pos-cap-preview">
          {shown ? <img src={shown} alt={previewAlt || t("adm.pos.cap.preview")} /> : <span className="pos-cap-pdf"><Icon name="clipboard" size={22} /> {t("adm.pos.cap.pdf")}<small>{local?.name}</small></span>}
          <figcaption>
            {touch && <button type="button" className="btn-sm" disabled={busy} onClick={() => camRef.current?.click()}><Icon name="camera" size={15} /> {t("adm.pos.cap.retake")}</button>}
            {onClear && <button type="button" className="btn-sm ghost" disabled={busy} onClick={clear}><Icon name="trash" size={15} /> {t("adm.pos.cap.remove")}</button>}
          </figcaption>
        </figure>
      )}
    </div>
  );
}
