// Dónde se usa: Tiendas → Editar (Stores.jsx). Puntos de venta de UNA tienda:
// alta, lista con búsqueda / filtro / paginación, edición y eliminación.
// El servidor decide qué se puede borrar o desactivar (lib/pos.ts
// terminalDeleteProblem / terminalDeactivateProblem); aquí solo se anticipa
// para no ofrecer un botón que va a fallar.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { createTerminal, deleteTerminal, listTerminalsWithUsage, updateTerminal } from "./posApi.js";

const PAGE_SIZE = 8;
const EMPTY_NEW = { name: "", receipt_locale: "es", ticket_locale: "en" };
const LOCALES = ["es", "en"];

const usedFor = (u) => (u ? u.sales + u.cash_sessions + u.approvals : 0);

export default function StoreTerminals({ store, disabled = false }) {
  const { t } = useLang();
  const { toast, confirm } = useFeedback();
  const [list, setList] = useState([]);
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all"); // all | active | inactive
  const [page, setPage] = useState(0);
  const [draftNew, setDraftNew] = useState(EMPTY_NEW);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(null);

  const load = () => {
    setState("loading");
    listTerminalsWithUsage(store.id)
      .then((r) => { setList(r.terminals || []); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(load, [store.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return list
      .filter((x) => status === "all" || (status === "active" ? x.is_active : !x.is_active))
      .filter((x) => !term || `${x.code} ${x.name || ""}`.toLowerCase().includes(term))
      // Op1-POS2 antes que Op1-POS10 (orden numérico, no alfabético).
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [list, q, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  useEffect(() => { setPage(0); }, [q, status]);

  const activeCount = list.filter((x) => x.is_active).length;

  // Toda escritura recarga con el uso al día (el servidor devuelve la lista sin él).
  const run = async (fn, okKey, params) => {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      toast({ tone: "success", title: t(okKey, params) });
      load();
      return true;
    } catch (e) {
      toast({ tone: "error", title: t(e.message) });
      return false;
    } finally { setBusy(false); }
  };

  const add = async (e) => {
    e.preventDefault();
    const ok = await run(() => createTerminal({ store: store.id, ...draftNew, name: draftNew.name.trim() || undefined }), "adm.stores.tills.created");
    if (ok) setDraftNew(EMPTY_NEW);
  };
  const startEdit = (x) => { setEditId(x.id); setDraft({ name: x.name || "", receipt_locale: x.receipt_locale, ticket_locale: x.ticket_locale, is_active: x.is_active }); };
  const save = async (x) => {
    const ok = await run(() => updateTerminal(x.id, { ...draft, name: draft.name.trim() }), "adm.stores.tills.saved", { code: x.code });
    if (ok) { setEditId(null); setDraft(null); }
  };
  const remove = async (x) => {
    const yes = await confirm({ tone: "danger", title: t("adm.stores.tills.deleteTitle", { code: x.code }), message: t("adm.stores.tills.deleteBody"), confirmLabel: t("adm.stores.tills.delete") });
    if (yes) run(() => deleteTerminal(x.id), "adm.stores.tills.deleted", { code: x.code });
  };

  // Por qué no se puede borrar / desactivar (mismo orden que el servidor).
  const deleteBlock = (x) => {
    if (list.length <= 1) return "last_terminal";
    if (x.usage?.sellers) return "terminal_has_sellers";
    if (usedFor(x.usage)) return "terminal_in_use";
    return null;
  };
  const deactivateBlock = (x) => {
    if (!x.is_active) return null;
    if (activeCount <= 1) return "last_terminal";
    if (x.usage?.active_sellers) return "terminal_has_sellers";
    if (x.usage?.open_cash) return "terminal_cash_open";
    return null;
  };

  const localeSelect = (value, onChange, label) => (
    <select className="adm-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label}>
      {LOCALES.map((l) => <option key={l} value={l}>{label}: {l.toUpperCase()}</option>)}
    </select>
  );

  return (
    <section className="adm-tills" aria-label={t("adm.stores.tills.title", { code: store.code })}>
      <h4><Icon name="receipt" size={15} /> {t("adm.stores.tills.title", { code: store.code })}</h4>
      <p className="adm-sub">{t("adm.stores.tills.sub")}</p>

      <form className="adm-tills-new" onSubmit={add}>
        <input className="adm-input" maxLength={60} value={draftNew.name} onChange={(e) => setDraftNew({ ...draftNew, name: e.target.value })}
          placeholder={t("adm.pos.cfg.terminalName")} aria-label={t("adm.pos.cfg.terminalName")} disabled={disabled} />
        {localeSelect(draftNew.receipt_locale, (v) => setDraftNew({ ...draftNew, receipt_locale: v }), t("adm.pos.cfg.receiptLang"))}
        {localeSelect(draftNew.ticket_locale, (v) => setDraftNew({ ...draftNew, ticket_locale: v }), t("adm.pos.cfg.ticketLang"))}
        <button className="btn-sm primary" disabled={disabled || busy}><Icon name="plus" size={14} /> {t("adm.pos.cfg.addTerminal")}</button>
      </form>

      <div className="adm-tills-tools">
        <label className="adm-find compact"><Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("adm.stores.tills.searchPh")} aria-label={t("adm.stores.tills.searchPh")} />
        </label>
        <div className="adm-range" role="group" aria-label={t("adm.stores.tills.statusFilter")}>
          {["all", "active", "inactive"].map((k) => (
            <button key={k} type="button" className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{t(`adm.stores.tills.status.${k}`)}</button>
          ))}
        </div>
      </div>

      {state === "loading" && !list.length && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      {state === "error" && <div className="adm-login-err">{t("adm.stores.tills.loadFailed")}</div>}
      {state === "ok" && filtered.length === 0 && <div className="adm-nodata">{list.length ? t("adm.stores.tills.noMatch") : t("adm.stores.tills.empty")}</div>}

      {shown.length > 0 && (
        <div className="adm-table-wrap">
          <table className="adm-table responsive adm-tills-table">
            <thead>
              <tr>
                <th>{t("adm.stores.tills.code")}</th><th>{t("adm.stores.tills.name")}</th>
                <th>{t("adm.pos.cfg.receiptLang")} / {t("adm.pos.cfg.ticketLang")}</th>
                <th>{t("adm.stores.tills.usage")}</th><th>{t("adm.stores.tills.statusCol")}</th><th className="r">{t("adm.stores.tills.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => {
                const editing = editId === x.id;
                const delBlock = deleteBlock(x);
                const offBlock = editing && draft && !draft.is_active ? deactivateBlock(x) : null;
                return (
                  <Fragment key={x.id}>
                  <tr className={x.is_active ? "" : "muted-row"}>
                    <td data-label={t("adm.stores.tills.code")}><b className="adm-tills-code">{x.code}</b></td>
                    <td data-label={t("adm.stores.tills.name")}>
                      {editing
                        ? <input className="adm-input" maxLength={60} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label={t("adm.pos.cfg.terminalName")} placeholder={t("adm.pos.cfg.terminalName")} />
                        : x.name || <span className="muted">—</span>}
                    </td>
                    <td data-label={`${t("adm.pos.cfg.receiptLang")} / ${t("adm.pos.cfg.ticketLang")}`}>
                      {editing ? (
                        <div className="adm-tills-locales">
                          {localeSelect(draft.receipt_locale, (v) => setDraft({ ...draft, receipt_locale: v }), t("adm.pos.cfg.receiptLang"))}
                          {localeSelect(draft.ticket_locale, (v) => setDraft({ ...draft, ticket_locale: v }), t("adm.pos.cfg.ticketLang"))}
                        </div>
                      ) : `${x.receipt_locale.toUpperCase()} / ${x.ticket_locale.toUpperCase()}`}
                    </td>
                    <td data-label={t("adm.stores.tills.usage")}>
                      <small className="muted">{t("adm.stores.tills.usageText", { sales: x.usage?.sales ?? 0, sellers: x.usage?.sellers ?? 0 })}</small>
                      {x.usage?.open_cash ? <span className="adm-chip neutral"><Icon name="wallet" size={11} />{t("adm.stores.tills.cashOpen")}</span> : null}
                    </td>
                    <td data-label={t("adm.stores.tills.statusCol")}>
                      {editing ? (
                        <label className="adm-tills-check">
                          <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} /> {t("adm.pos.cfg.active")}
                        </label>
                      ) : (
                        <span className={`adm-chip ${x.is_active ? "ok" : "bad"}`}>{t(x.is_active ? "adm.stores.tills.status.active" : "adm.stores.tills.status.inactive")}</span>
                      )}
                    </td>
                    <td data-label={t("adm.stores.tills.actions")} className="r">
                      <div className="adm-tills-actions">
                        {editing ? (
                          <>
                            <button type="button" className="btn-xs primary" disabled={busy || !!offBlock} onClick={() => save(x)}><Icon name="save" size={12} /> {t("adm.stores.save")}</button>
                            <button type="button" className="btn-xs" disabled={busy} onClick={() => { setEditId(null); setDraft(null); }}>{t("adm.stores.cancel")}</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="btn-xs" disabled={disabled || busy} onClick={() => startEdit(x)}><Icon name="edit" size={12} /> {t("adm.stores.edit")}</button>
                            <button type="button" className="btn-xs warn" disabled={disabled || busy || !!delBlock}
                              title={delBlock ? t(`adm.err.pos.${delBlock}`) : t("adm.stores.tills.delete")} onClick={() => remove(x)}>
                              <Icon name="trash" size={12} /> {t("adm.stores.tills.delete")}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Por qué no se puede desactivar: fila completa para no ensanchar la tabla. */}
                  {offBlock && (
                    <tr className="adm-tills-why-row"><td colSpan={6}><span className="adm-login-err adm-tills-why"><Icon name="alert" size={12} /> {t(`adm.err.pos.${offBlock}`)}</span></td></tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="adm-pager">
          <span className="muted">{t("adm.ord.pagerRange", { first: current * PAGE_SIZE + 1, last: Math.min((current + 1) * PAGE_SIZE, filtered.length), total: filtered.length })}</span>
          <div>
            <button type="button" className="btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>{t("adm.ord.prev")}</button>
            <span className="adm-pager-n">{current + 1} / {pages}</span>
            <button type="button" className="btn-sm" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>{t("adm.ord.next")}</button>
          </div>
        </div>
      )}
      <p className="adm-sub adm-team-note">{t("adm.stores.tills.rules")}</p>
    </section>
  );
}
