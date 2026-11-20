// Dónde se usa: Nueva venta → paso Cobro (WearingCapture, la foto viaja tras
// registrar la venta) y la ficha de una venta (WearingPhotoPanel: verla al
// entregar, tomarla si faltó, cambiarla o quitarla).
//
// La foto del paciente con la montura puesta es opcional y se queda en la
// tienda (docs/WEARING-PHOTO.md): nunca va en recibos, correos, el ticket del
// laboratorio ni la hoja. Se toma con autorización del paciente (la casilla va
// primero; sin ella no hay botones de cámara). Se lee como Blob desde
// GET /admin/pos/sales/:id/wearing-photo (nunca un enlace) y cada lectura
// queda en Auditoría; el object URL se libera al cerrar la ficha.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import PosCapture from "./PosCapture.jsx";
import { fetchWearingPhoto, photoDataUrl, removeWearingPhoto, setWearingPhoto } from "./posApi.js";
import "./wearing-photo.css";

const errKey = (e) => (e?.message?.startsWith("adm.") ? e.message : "adm.err.pos.generic");

/** Imagen a pantalla completa; se cierra con un toque, con Escape o con el botón. */
function Lightbox({ src, onClose }) {
  const { t } = useLang();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="wear-lightbox" role="dialog" aria-modal="true" aria-label={t("adm.wear.alt")} onClick={onClose}>
      <img src={src} alt={t("adm.wear.alt")} />
      <button type="button" className="wear-lightbox-close" onClick={onClose} aria-label={t("adm.wear.close")} title={t("adm.wear.close")}><Icon name="close" size={20} /></button>
    </div>,
    document.body,
  );
}

/**
 * Casilla de autorización + cámara/galería, controlada:
 *   value = { consent: boolean, photo: dataURL | null }
 *   onChange(next)
 * Quitar la autorización quita también la foto.
 */
export function WearingCapture({ value, onChange, busy = false, hint = null }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [preparing, setPreparing] = useState(false);
  const onFile = async (f) => {
    setPreparing(true);
    try { onChange({ ...value, photo: await photoDataUrl(f) }); }
    catch (err) { toast({ tone: "error", title: t(errKey(err)) }); }
    finally { setPreparing(false); }
  };
  return (
    <div className="wear-capture">
      <label className="pos-check wear-consent">
        <input type="checkbox" checked={value.consent} disabled={busy} onChange={(e) => onChange({ consent: e.target.checked, photo: e.target.checked ? value.photo : null })} />
        {t("adm.wear.consent")}
      </label>
      {value.consent ? (
        <PosCapture onFile={onFile} preview={value.photo} cameraLabel={t("adm.wear.take")} fileLabel={t("adm.wear.file")} busy={busy || preparing}
          busyLabel={t("adm.wear.loading")} onClear={() => onChange({ ...value, photo: null })} previewAlt={t("adm.wear.alt")} className="wear-cap" />
      ) : (
        <small className="muted">{t("adm.wear.consentFirst")}</small>
      )}
      {value.photo && hint && <small className="muted">{hint}</small>}
    </div>
  );
}

/** La tarjeta de Nueva venta, paso Cobro. */
export function WearingCaptureCard({ value, onChange, busy }) {
  const { t } = useLang();
  return (
    <section className="wear-card" aria-labelledby="wear-card-title">
      <header className="wear-card-head">
        <Icon name="camera" size={16} />
        <h4 id="wear-card-title">{t("adm.wear.title")}</h4>
        <span className="adm-chip">{t("adm.wear.optional")}</span>
      </header>
      <p className="wear-why">{t("adm.wear.why")}</p>
      <WearingCapture value={value} onChange={onChange} busy={busy} hint={t("adm.wear.ready")} />
    </section>
  );
}

/**
 * Ficha de la venta. `sale` (con has_wearing_photo / wearing_photo_at),
 * `canManage` (permissions.can_wearing_photo), `pickup` (la venta está por
 * entregar: la foto se destaca con el aviso de comparar), `onSale(sale)`.
 * Sin foto y sin permiso para tomarla, no pinta nada.
 */
export function WearingPhotoPanel({ sale, canManage = false, pickup = false, onSale }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [url, setUrl] = useState(null);
  const [state, setState] = useState("idle"); // idle | loading | error
  const [zoom, setZoom] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ consent: false, photo: null });
  const [busy, setBusy] = useState(false);
  const has = Boolean(sale?.has_wearing_photo);
  const voided = sale?.status === "voided";

  const load = useCallback(() => {
    if (!sale?.id || !has) return () => {};
    let alive = true;
    let objectUrl = null;
    setState("loading");
    fetchWearingPhoto(sale.id)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState("idle");
      })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); setUrl(null); };
  }, [sale?.id, has, sale?.wearing_photo_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reload, setReload] = useState(0);
  useEffect(() => load(), [load, reload]);

  if (!sale || (!has && !(canManage && !voided))) return null;

  const save = async () => {
    if (!draft.photo) return;
    setBusy(true);
    try {
      const r = await setWearingPhoto(sale.id, draft.photo);
      setAdding(false); setDraft({ consent: false, photo: null });
      toast({ tone: "success", title: t("adm.wear.saved") });
      if (r?.sale) onSale?.(r.sale);
    } catch (e) { toast({ tone: "error", title: t(errKey(e)) }); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: t("adm.wear.removeConfirm"), message: t("adm.wear.removeHint"), tone: "danger" }))) return;
    setBusy(true);
    try {
      const r = await removeWearingPhoto(sale.id);
      toast({ tone: "success", title: t("adm.wear.removed") });
      if (r?.sale) onSale?.(r.sale);
    } catch (e) { toast({ tone: "error", title: t(errKey(e)) }); }
    finally { setBusy(false); }
  };
  const when = sale.wearing_photo_at ? new Date(sale.wearing_photo_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className={`wear-panel ${has && pickup ? "is-pickup" : ""}`}>
      {has && (
        <div className="wear-show">
          <button type="button" className="wear-thumb" onClick={() => url && setZoom(true)} disabled={!url} aria-label={t("adm.wear.zoom")} title={t("adm.wear.zoom")}>
            {url ? <img src={url} alt={t("adm.wear.alt")} /> : <span className="wear-thumb-empty"><Icon name={state === "error" ? "alert" : "camera"} size={26} /></span>}
            {url && <span className="wear-zoom-badge"><Icon name="search" size={13} /></span>}
          </button>
          <div className="wear-info">
            {pickup && <p className="wear-compare"><Icon name="eye" size={15} /> {t("adm.wear.compare")}</p>}
            {state === "loading" && <small className="muted">{t("adm.wear.loading")}</small>}
            {state === "error" && (
              <small className="wear-err">{t("adm.wear.loadFailed")} <button type="button" className="btn-xs" onClick={() => setReload((n) => n + 1)}>{t("adm.wear.retry")}</button></small>
            )}
            {when && <small className="muted">{t("adm.wear.savedAt", { date: when })}</small>}
            <small className="muted wear-privacy"><Icon name="lock" size={11} /> {t("adm.wear.privacy")}</small>
            {canManage && (
              <div className="wear-actions adm-noprint">
                {!voided && <button type="button" className="btn-sm" disabled={busy} aria-pressed={adding} onClick={() => setAdding((a) => !a)}><Icon name="camera" size={14} /> {t("adm.wear.replace")}</button>}
                <button type="button" className="btn-sm danger" disabled={busy} onClick={remove}><Icon name="trash" size={14} /> {t("adm.wear.remove")}</button>
              </div>
            )}
          </div>
        </div>
      )}
      {!has && !adding && (
        <div className="wear-none">
          <small className="muted">{t("adm.wear.none")}</small>
          <button type="button" className="btn-sm" disabled={busy} onClick={() => setAdding(true)}><Icon name="camera" size={14} /> {t("adm.wear.take")}</button>
        </div>
      )}
      {adding && (
        <div className="wear-add adm-noprint">
          <WearingCapture value={draft} onChange={setDraft} busy={busy} />
          <div className="wear-actions">
            <button type="button" className="btn-sm primary" disabled={busy || !draft.photo} onClick={save}><Icon name="check" size={14} /> {t("adm.wear.save")}</button>
            <button type="button" className="btn-sm" disabled={busy} onClick={() => { setAdding(false); setDraft({ consent: false, photo: null }); }}>{t("adm.wear.cancel")}</button>
          </div>
        </div>
      )}
      {zoom && url && <Lightbox src={url} onClose={() => setZoom(false)} />}
    </div>
  );
}
