// Vista previa de «Importar Excel» en «Productos y precios»: el plan que
// devolvió POST /admin/pricing/matrix/import { apply: false } — cuántas
// casillas cambian, la tabla de cambios (artículo · tienda · campo · antes →
// después) y los errores — y «Aplicar», que manda el MISMO lote con
// apply: true. Con errores no se aplica nada (el servidor tampoco: 422
// import_has_errors), así que el botón se apaga y se dice por qué.
import { useMemo } from "react";
import { useLang } from "../../../i18n/LanguageContext.jsx";
import { money } from "../../adminOrders.js";
import Icon from "../../icons.jsx";
import Modal from "./Modal.jsx";

const fmt = (field, v, t, lang) => {
  if (v === null || v === undefined || v === "") return field === "price" ? t("adm.pm.imp.rule") : "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return field === "discount" ? `${Math.round(n * 100) / 100} %` : money(n, "usd", lang);
};

export default function ImportDialog({ file, local, plan, stores = [], busy = false, onApply, onClose }) {
  const { t, lang } = useLang();
  const changes = plan?.changes || [];
  const errors = plan?.errors || [];
  const storeOf = useMemo(() => {
    const m = new Map();
    for (const s of stores) { m.set(s.id, s); m.set(s.code, s); }
    return m;
  }, [stores]);
  const counts = plan?.counts || {};
  const byField = changes.reduce((a, c) => ({ ...a, [c.field]: (a[c.field] || 0) + 1 }), {});
  const pills = [
    { k: "changes", v: changes.length, strong: true },
    { k: "price", v: counts.price ?? byField.price ?? 0 },
    { k: "discount", v: counts.discount ?? byField.discount ?? 0 },
    { k: "cost", v: counts.cost ?? byField.cost ?? 0 },
    { k: "unchanged", v: local?.unchanged ?? 0 },
    ...(errors.length ? [{ k: "errors", v: errors.length, tone: "bad" }] : []),
  ];

  return (
    <Modal
      wide
      title={t("adm.pm.imp.title")}
      sub={t("adm.pm.imp.sub", { file: file || "" })}
      onClose={onClose}
      footer={
        <>
          {errors.length > 0 && <span className="pm-f-err grow"><Icon name="alert" size={13} /> {t("adm.pm.imp.fixFirst")}</span>}
          <button type="button" className="btn-sm" onClick={onClose}>{t("adm.pm.cancel")}</button>
          <button type="button" className="btn-sm primary" disabled={busy || errors.length > 0 || changes.length === 0} onClick={onApply}>
            <Icon name="check" size={14} /> {busy ? t("adm.pm.saving") : t("adm.pm.imp.apply", { n: changes.length })}
          </button>
        </>
      }
    >
      <div className="pm-imp-pills">
        {pills.map((p) => (
          <span key={p.k} className={`pm-imp-pill ${p.strong ? "strong" : ""} ${p.tone || ""}`}>
            <b>{p.v}</b> {t(`adm.pm.imp.count.${p.k}`)}
          </span>
        ))}
      </div>
      {local?.unknownStores?.length > 0 && (
        <p className="pm-imp-note warn"><Icon name="alert" size={13} /> {t("adm.pm.imp.unknownStores", { codes: local.unknownStores.join(", ") })}</p>
      )}
      {errors.length > 0 && (
        <div className="pm-imp-errs" role="alert">
          <h4>{t("adm.pm.imp.errors")}</h4>
          <ul>
            {errors.slice(0, 50).map((e, i) => (
              <li key={i}>
                <b>{t("adm.pm.imp.rowN", { n: e.row ?? "?" })}</b> {t(`adm.err.pricing.${e.reason}`)}{e.detail ? <span className="muted"> · {String(e.detail)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {changes.length === 0 ? (
        <p className="pm-imp-note">{t("adm.pm.imp.none")}</p>
      ) : (
        <div className="pm-imp-scroll">
          <table className="pm-imp-table">
            <thead>
              <tr>
                <th>{t("adm.pm.imp.col.item")}</th>
                <th>{t("adm.pm.store")}</th>
                <th>{t("adm.pm.imp.col.field")}</th>
                <th className="r">{t("adm.pm.imp.col.before")}</th>
                <th aria-hidden="true" />
                <th className="r">{t("adm.pm.imp.col.after")}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => {
                const s = c.store ? storeOf.get(c.store) : null;
                // A price or cost that falls by more than half is almost always a typo in the sheet.
                const drop = c.field !== "discount" && Number(c.before) > 0 && c.after != null && Number(c.after) < Number(c.before) * 0.5;
                return (
                  <tr key={i} className={drop ? "warn" : ""} title={drop ? t("adm.pm.imp.dropHint") : undefined}>
                    <td><b>{c.item || c.key || c.sku}</b>{c.section ? <small className="muted"> · {t(`adm.pm.sub.${c.section}`)}</small> : null}</td>
                    <td>{s ? <><span className="pm-dot" style={{ background: s.color }} /> {s.code}</> : c.store ? c.store : <span className="muted">{t("adm.pm.imp.allStores")}</span>}</td>
                    <td>{t(`adm.pm.field.${c.field}`)}</td>
                    <td className="r muted">{fmt(c.field, c.before, t, lang)}</td>
                    <td className="c muted" aria-hidden="true"><Icon name="arrowRight" size={12} /></td>
                    <td className="r"><b>{drop && <Icon name="alert" size={12} />} {fmt(c.field, c.after, t, lang)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
