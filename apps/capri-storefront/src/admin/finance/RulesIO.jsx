// Exportar e importar TODO «Reglas y comisiones» como un solo libro de Excel
// (finance/rulesXlsx.js). Importar = leer el libro en el navegador → POST
// /admin/finance/rules/import { apply: false } → diálogo con el plan (altas,
// cambios campo a campo antes → después, sin cambios, errores) → «Aplicar»
// manda el MISMO lote con apply: true. Con errores no se aplica nada (el
// servidor tampoco: 422 import_has_errors). Mismo enfoque que la importación
// de la matriz de precios (pricing/matrix/ImportDialog.jsx), en componente
// propio. Nada se borra al importar.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import { downloadBytes } from "../exportXlsx.js";
import Icon from "../icons.jsx";
import { importRules } from "./financeApi.js";
import { buildRulesWorkbook, parseRulesWorkbook } from "./rulesXlsx.js";

const MONEY_FIELDS = new Set(["amount_cents"]);

function fmt(field, v, t, lang, storeCode = (x) => x) {
  if (v === null || v === undefined || v === "") return "—";
  if (MONEY_FIELDS.has(field)) return money(Number(v) / 100, "usd", lang);
  if (field === "amount") return String(v);
  if (field === "pct") return `${v} %`;
  if (field === "frequency") return t(`adm.fin.freq.${v}`);
  if (field === "tax_category") return t(`adm.fin.tax.${v}`);
  if (field === "kind") return t(`adm.fin.kind.${v}`);
  if (field === "category") return t(`adm.costs2.cat.${v}`);
  if (field === "establishment_id") return storeCode(v);
  if (typeof v === "boolean") return v ? t("adm.fin.xl.yes") : t("adm.fin.xl.no");
  if (typeof v === "object") return v.method === "percent" ? t("adm.fin.f.byPercent") : t("adm.fin.f.bySales");
  return String(v);
}

function Dialog({ title, sub, onClose, footer, children }) {
  const { t } = useLang();
  const card = useRef(null);
  useEffect(() => {
    const back = document.activeElement;
    card.current?.querySelector("button")?.focus();
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); back?.focus?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const host = (typeof document !== "undefined" && (document.querySelector(".adm-shell") || document.body)) || null;
  if (!host) return null;
  return createPortal(
    <div className="fin-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fin-modal" role="dialog" aria-modal="true" aria-label={title} ref={card}>
        <header className="fin-modal-h">
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <button type="button" className="fin-ib" onClick={onClose} aria-label={t("adm.fin.close")} title={t("adm.fin.close")}><Icon name="close" size={16} /></button>
        </header>
        <div className="fin-modal-b">{children}</div>
        {footer && <footer className="fin-modal-f">{footer}</footer>}
      </div>
    </div>,
    host
  );
}

export default function RulesIO({ data, who, business, onApplied, onError }) {
  const { t, lang } = useLang();
  const fileRef = useRef(null);
  const [state, setState] = useState(null); // { file, payload, plan, missing }
  const [busy, setBusy] = useState(false);

  const exportXlsx = () => {
    try {
      const bytes = buildRulesWorkbook({ data, t, lang, who, business });
      downloadBytes(`reglas-y-comisiones-${new Date().toISOString().slice(0, 10)}.xlsx`, bytes);
    } catch {
      onError("adm.err.fin.export_failed");
    }
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseRulesWorkbook(new Uint8Array(await file.arrayBuffer()));
      if (parsed.missing.includes("all")) throw new Error("adm.err.fin.not_our_workbook");
      const { missing, ...payload } = parsed;
      const plan = await importRules(payload, false);
      setState({ file: file.name, payload, plan, missing });
    } catch (err) {
      onError(err.message?.startsWith("adm.") ? err.message : "adm.err.fin.import_failed");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!state) return;
    setBusy(true);
    try {
      await importRules(state.payload, true);
      setState(null);
      onApplied();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const plan = state?.plan;
  const codeOf = (id) => (id ? data.stores.find((s) => s.id === id)?.code || id : t("adm.fin.shared"));
  const errors = plan?.errors || [];
  const changes = plan?.changes || [];

  return (
    <>
      <button type="button" className="btn-xs" onClick={exportXlsx} title={t("adm.fin.io.exportHint")}><Icon name="excel" size={13} /> {t("adm.fin.io.export")}</button>
      <button type="button" className="btn-xs" onClick={() => fileRef.current?.click()} disabled={busy} title={t("adm.fin.io.importHint")}><Icon name="upload" size={13} /> {busy && !state ? t("adm.fin.io.reading") : t("adm.fin.io.import")}</button>
      <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={pick} />
      {state && (
        <Dialog
          title={t("adm.fin.io.planTitle")}
          sub={t("adm.fin.io.planSub", { file: state.file })}
          onClose={() => setState(null)}
          footer={
            <>
              {errors.length > 0 && <span className="fin-err grow"><Icon name="alert" size={13} /> {t("adm.fin.io.fixFirst")}</span>}
              <button type="button" className="btn-sm" onClick={() => setState(null)}>{t("adm.fin.cancel")}</button>
              <button type="button" className="btn-sm primary" disabled={busy || errors.length > 0 || changes.length === 0} onClick={apply}>
                <Icon name="check" size={14} /> {busy ? t("adm.fin.io.applying") : t("adm.fin.io.apply", { n: changes.length })}
              </button>
            </>
          }
        >
          <div className="fin-pills">
            <span className="fin-pill strong"><b>{changes.length}</b> {t("adm.fin.io.count.changes")}</span>
            <span className="fin-pill"><b>{plan.counts?.create ?? 0}</b> {t("adm.fin.io.count.create")}</span>
            <span className="fin-pill"><b>{plan.counts?.update ?? 0}</b> {t("adm.fin.io.count.update")}</span>
            <span className="fin-pill"><b>{plan.unchanged ?? 0}</b> {t("adm.fin.io.count.unchanged")}</span>
            {errors.length > 0 && <span className="fin-pill bad"><b>{errors.length}</b> {t("adm.fin.io.count.errors")}</span>}
          </div>
          {state.missing.length > 0 && <p className="fin-note warn"><Icon name="alert" size={12} /> {t("adm.fin.io.missing", { sheets: state.missing.map((m) => t(`adm.fin.io.sheet.${m}`)).join(", ") })}</p>}
          <p className="fin-note"><Icon name="info" size={12} /> {t("adm.fin.io.noDelete")}</p>
          {errors.length > 0 && (
            <div className="fin-errs" role="alert">
              <h4>{t("adm.fin.io.errors")}</h4>
              <ul>
                {errors.slice(0, 60).map((e, i) => (
                  <li key={i}><b>{t(`adm.fin.io.sheet.${e.sheet}`)}{e.row ? ` · ${t("adm.fin.io.rowN", { n: e.row })}` : ""}</b> {t(`adm.err.fin.${e.reason}`)}{e.detail ? <span className="muted"> · {String(e.detail)}</span> : null}</li>
                ))}
              </ul>
            </div>
          )}
          {changes.length === 0 ? (
            <p className="fin-note">{t("adm.fin.io.none")}</p>
          ) : (
            <div className="fin-plan-scroll">
              <table className="fin-plan">
                <thead><tr><th>{t("adm.fin.io.col.sheet")}</th><th>{t("adm.fin.io.col.item")}</th><th>{t("adm.fin.io.col.field")}</th><th className="r">{t("adm.fin.io.col.before")}</th><th aria-hidden="true" /><th className="r">{t("adm.fin.io.col.after")}</th></tr></thead>
                <tbody>
                  {changes.flatMap((c, i) => {
                    const entries = Object.entries(c.fields).filter(([, [b, a]]) => c.op === "update" || (a !== null && a !== "" && a !== undefined));
                    return entries.map(([field, [before, after]], j) => (
                      <tr key={`${i}-${field}`} className={c.op === "create" ? "new" : ""}>
                        {j === 0 && <td rowSpan={entries.length}>{t(`adm.fin.io.sheet.${c.sheet}`)}{c.op === "create" && <span className="fin-chip new">{t("adm.fin.io.new")}</span>}</td>}
                        {j === 0 && <td rowSpan={entries.length}><b>{c.label === "default" ? t("adm.fin.comm.default") : c.label}</b></td>}
                        <td>{t(`adm.fin.io.field.${field}`)}</td>
                        <td className="r muted">{fmt(field, before, t, lang, codeOf)}</td>
                        <td className="c muted" aria-hidden="true"><Icon name="arrowRight" size={12} /></td>
                        <td className="r"><b>{fmt(field, after, t, lang, codeOf)}</b></td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
