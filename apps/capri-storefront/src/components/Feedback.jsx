import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";

/**
 * App-wide feedback layer: non-blocking toasts and accessible modal dialogs.
 * Replaces the native alert()/confirm() dialogs, which block the main thread,
 * cannot be styled or translated, and look like a browser warning to the user.
 *
 *   const { toast, dialog, confirm } = useFeedback();
 *   toast({ tone: "success", title: t("lens.added") });
 *   await dialog({ tone: "success", title, message });   // single button, ack only
 *   if (await confirm({ tone: "danger", title, message })) doIt();
 *
 * Every label falls back to a translated default, so call sites only pass copy
 * that is specific to them.
 */

const FeedbackContext = createContext(null);

const TONE_ICON = { success: "✓", error: "✕", warning: "!", info: "i", danger: "!" };
const TOAST_LIMIT = 3;
const DEFAULT_DURATION = 5000;

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function Toast({ data, onDismiss, closeLabel }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!data.duration || paused) return undefined;
    const id = setTimeout(() => onDismiss(data.id), data.duration);
    return () => clearTimeout(id);
  }, [data.id, data.duration, paused, onDismiss]);

  const hold = () => setPaused(true);
  const release = () => setPaused(false);

  return (
    <div
      className={`toast toast-${data.tone}`}
      role={data.tone === "error" ? "alert" : "status"}
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={release}
    >
      <span className="toast-icon" aria-hidden="true">{TONE_ICON[data.tone] || TONE_ICON.info}</span>
      <div className="toast-body">
        <b className="toast-title">{data.title}</b>
        {data.message && <p className="toast-msg">{data.message}</p>}
      </div>
      <button type="button" className="toast-x" aria-label={closeLabel} onClick={() => onDismiss(data.id)}>×</button>
      {data.duration ? (
        <span
          className="toast-bar"
          aria-hidden="true"
          style={{ animationDuration: `${data.duration}ms`, animationPlayState: paused ? "paused" : "running" }}
        />
      ) : null}
    </div>
  );
}

function Dialog({ data, onClose, t }) {
  const cardRef = useRef(null);
  const primaryRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const isConfirm = data.kind === "confirm";
  const danger = data.tone === "danger" || data.tone === "error";

  useEffect(() => {
    const restoreTo = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    primaryRef.current?.focus();

    // Keep keyboard focus inside the dialog while it is open.
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(false); return; }
      if (e.key !== "Tab") return;
      const nodes = cardRef.current?.querySelectorAll(FOCUSABLE);
      if (!nodes || !nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      try { restoreTo?.focus?.(); } catch { /* element may be gone */ }
    };
  }, [onClose]);

  return (
    <div className="dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(false); }}>
      <div
        ref={cardRef}
        className={`dlg dlg-${data.tone || "info"}`}
        role={isConfirm ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={data.message ? descId : undefined}
      >
        <button type="button" className="dlg-x" aria-label={t("dlg.close")} onClick={() => onClose(false)}>×</button>
        <div className="dlg-icon" aria-hidden="true">{TONE_ICON[data.tone] || TONE_ICON.info}</div>
        <h2 className="dlg-title" id={titleId}>{data.title}</h2>
        {data.message && <p className="dlg-msg" id={descId}>{data.message}</p>}
        {data.detail && <div className="dlg-detail">{data.detail}</div>}
        <div className="dlg-actions">
          {isConfirm && (
            <button type="button" className="btn btn-outline dlg-btn" onClick={() => onClose(false)}>
              {data.cancelLabel || t("dlg.cancel")}
            </button>
          )}
          <button
            ref={primaryRef}
            type="button"
            className={`btn dlg-btn ${danger ? "dlg-btn-danger" : "btn-primary"}`}
            onClick={() => onClose(true)}
          >
            {data.confirmLabel || (isConfirm ? t("dlg.confirm") : t("dlg.ok"))}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FeedbackProvider({ children }) {
  const { t } = useLang();
  const [toasts, setToasts] = useState([]);
  const [dialogData, setDialogData] = useState(null);
  const resolverRef = useRef(null);
  const seqRef = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((opts) => {
    const base = typeof opts === "string" ? { title: opts } : opts || {};
    const id = ++seqRef.current;
    const item = { tone: "info", duration: DEFAULT_DURATION, ...base, id };
    setToasts((prev) => [...prev, item].slice(-TOAST_LIMIT));
    return id;
  }, []);

  const closeDialog = useCallback((result) => {
    setDialogData(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  }, []);

  const openDialog = useCallback((opts) => new Promise((resolve) => {
    resolverRef.current?.(false); // a second dialog supersedes the pending one
    resolverRef.current = resolve;
    setDialogData({ tone: "info", ...opts });
  }), []);

  const dialog = useCallback((opts) => openDialog({ ...opts, kind: "alert" }), [openDialog]);
  const confirm = useCallback((opts) => openDialog({ ...opts, kind: "confirm" }), [openDialog]);

  const value = useMemo(() => ({ toast, dismissToast, dialog, confirm }), [toast, dismissToast, dialog, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {createPortal(
        <>
          <div className="toast-stack" aria-live="polite" aria-atomic="false">
            {toasts.map((item) => (
              <Toast key={item.id} data={item} onDismiss={dismissToast} closeLabel={t("dlg.close")} />
            ))}
          </div>
          {dialogData && <Dialog data={dialogData} onClose={closeDialog} t={t} />}
        </>,
        document.body
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside <FeedbackProvider>");
  return ctx;
}
