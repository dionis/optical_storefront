// Una imagen del catálogo en los diálogos de «Productos y precios»: logo de una
// marca, foto de un color o foto adicional de un modelo. Tres maneras de
// ponerla, porque el dueño trabaja en el escritorio y en la tablet del
// mostrador: subir un archivo (botón o arrastrar y soltar sobre la vista
// previa), tomarla con la cámara (solo en pantallas táctiles, `capture`), o
// pegar un enlace. Subir = POST /admin/catalog/uploads → `{ url }` (absoluta).
//
// JPG/PNG/WebP de hasta 8 MB van tal cual (un logo PNG conserva su fondo
// transparente); una foto HEIC del iPhone o una de 15 MB se convierte antes a
// JPEG de 1600 px (lib/imagePrep.js, la misma que usa la receta).
import { useEffect, useId, useRef, useState } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import { preparePrescriptionFile, withSniffedType } from "../../../lib/imagePrep.js";
import Icon from "../../icons.jsx";
import { uploadCatalogImage } from "../api.js";
import { BrandLogo, Thumb } from "./Media.jsx";
import { isImageUrl } from "./model.js";

const MAX_BYTES = 8 * 1024 * 1024;
const DIRECT = new Set(["image/jpeg", "image/png", "image/webp"]);

const isTouch = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);

/** A camera photo above this is re-encoded to a 1600 px JPEG before it travels (a tablet shot is 4–12 MB). */
const RESIZE_ABOVE = 1.5 * 1024 * 1024;
const IMAGE_NAME = /\.(jpe?g|png|webp|heic|heif)$/i;

/**
 * File → a file the server accepts, or throws an i18n key.
 *
 * A photo taken with the camera goes the same road as a chosen file, with two
 * things a camera does that a file picker rarely does: some Android browsers
 * hand the shot with an EMPTY mime type (it used to be refused as "not an
 * image" before it was even tried), and the shot is several megabytes — it is
 * reduced here so the upload is quick on the store's Wi-Fi and never meets a
 * size limit on the way. A PNG keeps going as it is (a logo keeps its
 * transparent background).
 */
async function prepare(picked) {
  if (!picked) throw new Error("adm.pm.img.badType");
  const file = await withSniffedType(picked);
  const type = String(file.type || "").toLowerCase();
  const looksImage = type.startsWith("image/") || IMAGE_NAME.test(file.name || "");
  if (!looksImage) throw new Error("adm.pm.img.badType");
  if (type === "image/png" && file.size <= MAX_BYTES) return file;
  if (DIRECT.has(type) && file.size <= RESIZE_ABOVE) return file;
  const out = await preparePrescriptionFile(file);
  if (!DIRECT.has(out.type)) throw new Error("adm.pm.img.badType");
  if (out.size > MAX_BYTES) throw new Error("adm.pm.img.tooBig");
  return out;
}

/**
 * @param value     current URL ("" = none)
 * @param onChange  (url) => void
 * @param variant   "logo" | "photo"
 * @param compact   one-line layout (colour rows)
 * @param name      brand name (logo monogram fallback)
 * @param onBusy    (busy:boolean) => void — the dialog waits for uploads before saving
 */
export default function ImageInput({ value = "", onChange, variant = "photo", compact = false, name = "", label, onBusy, icon = "glasses", invalid = false }) {
  const { t } = useLang();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);
  const [showUrl, setShowUrl] = useState(() => Boolean(value) && !isImageUrl(value));
  const [touch, setTouch] = useState(false);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  useEffect(() => setTouch(isTouch()), []);
  useEffect(() => { onBusy?.(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const take = async (file) => {
    if (!file || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const ready = await prepare(file);
      const res = await uploadCatalogImage(ready);
      onChange(res.url);
      setShowUrl(false);
    } catch (e) {
      setErr(String(e?.message || "").startsWith("adm.") ? e.message : "adm.err.pricing.upload_failed");
    } finally {
      setBusy(false);
    }
  };
  const onPick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    take(f);
  };
  const dropProps = {
    onDragOver: (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); setDrag(true); } },
    onDragLeave: () => setDrag(false),
    onDrop: (e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer?.files?.[0]); },
  };

  const preview = variant === "logo"
    ? (value || String(name || "").trim()
      ? <BrandLogo src={value} name={name} slug={name} className="pm-img-logo" />
      : <span className="pm-logo pm-img-logo pm-img-empty"><Icon name="imagePlus" size={24} strokeWidth={1.6} /></span>)
    : <Thumb src={value} size={compact ? 40 : 64} icon={icon} />;

  return (
    <div className={`pm-img ${compact ? "compact" : ""} ${drag ? "drag" : ""} ${busy ? "busy" : ""} ${invalid ? "invalid" : ""}`.trim()} {...dropProps}>
      <button
        type="button"
        className="pm-img-prev"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        aria-label={label || t("adm.pm.img.upload")}
        title={t("adm.pm.img.dropHint")}
      >
        {preview}
        {busy && <span className="pm-img-spin" aria-hidden="true" />}
        {drag && <span className="pm-img-drop">{t("adm.pm.img.drop")}</span>}
      </button>
      <div className="pm-img-side">
        <div className="pm-img-acts">
          <button type="button" className="btn-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Icon name="upload" size={13} /> {busy ? t("adm.pm.img.uploading") : t("adm.pm.img.upload")}
          </button>
          {touch && (
            <button type="button" className="btn-xs" onClick={() => camRef.current?.click()} disabled={busy} aria-label={t("adm.pm.img.camera")} title={t("adm.pm.img.camera")}>
              <Icon name="camera" size={14} /> {!compact && t("adm.pm.img.camera")}
            </button>
          )}
          <button type="button" className={`btn-xs ${showUrl ? "on" : ""}`} onClick={() => setShowUrl((v) => !v)} aria-pressed={showUrl} aria-label={t("adm.pm.img.link")} title={t("adm.pm.img.link")}>
            <Icon name="link" size={13} /> {!compact && t("adm.pm.img.link")}
          </button>
          {value && (
            <button type="button" className="btn-xs pm-img-x" onClick={() => { onChange(""); setErr(null); }} disabled={busy} aria-label={t("adm.pm.img.remove")} title={t("adm.pm.img.remove")}>
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
        {showUrl && (
          <input
            id={`${id}-url`}
            className="pp-input pm-img-url"
            type="url"
            inputMode="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("adm.pm.add.imagePh")}
            aria-label={t("adm.pm.img.linkAria")}
          />
        )}
        {err ? <small className="pm-f-err" role="alert">{t(err)}</small> : !compact && <small className="pm-f-hint">{t("adm.pm.img.hint")}</small>}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={onPick} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
    </div>
  );
}
