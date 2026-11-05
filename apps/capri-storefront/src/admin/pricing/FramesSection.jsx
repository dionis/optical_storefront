// Dónde se usa: «Precios y costos» → acordeón «Monturas y estuches».
// Lo que pidió el dueño, tal cual: UNA regla para todas las monturas (y otra
// para los estuches) y, si quiere cambiar una montura a pesar de la regla, la
// busca y le pone el precio — y entonces la pantalla enseña solo la regla y los
// modelos que tocó. Con una tienda elegida arriba, la regla y las excepciones
// son las de esa tienda, con «Heredado» donde cae al maestro.
//
// Desde el 1-nov-2026 la vista lleva también el COSTO del proveedor, que es lo
// que hace que la contabilidad cuadre: sale de GET /admin/pricing/frames/costs
// (nunca más del navegador), se edita con POST /admin/pricing/frames/cost, y al
// lado del costo y del precio se enseña el margen que sale de los dos. Lo
// primero que se ve es cuántos modelos del catálogo tienen costo y cuántos NO,
// con un atajo para quedarse solo con los que faltan: un modelo sin costo no
// enseña «0 %» de margen, enseña que falta, porque es lo único honesto.
//
// El costo tiene las MISMAS dos capas que el precio, y se leen igual: con
// «Todas las tiendas» se ve y se edita el MAESTRO (lo que paga la cadena) y con
// una tienda elegida arriba se ve y se edita LA VARIACIÓN DE ESA TIENDA, con la
// pastilla «Heredado» y el maestro a la vista cuando no maneja costo propio.
// El alcance viaja en `store`, el mismo que ya usan la regla y el precio exacto.
//
// Y desde el 3-nov-2026 lleva el SUELO Y EL TECHO del precio (GET/POST
// /admin/pricing/frames/band): lo que el dueño pone una vez para toda la cadena
// y luego dobla tienda por tienda, con la vista previa de a cuántos modelos le
// mueve el precio ANTES de guardar. Ver `BandBlock`.
//
// Y desde el 5-nov-2026, «Un modelo en todas las tiendas» (HU-13, GET
// /admin/pricing/frames/across): se busca un modelo o un SKU y se ve lo que
// cobra CADA tienda hoy en una sola fila, con el mismo cálculo de la caja. Ver
// `AcrossBlock`.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import { searchStoreCatalog } from "../adminStores.js";
import DataTable from "../DataTable.jsx";
import HelpTip from "../HelpTip.jsx";
import Icon from "../icons.jsx";
import { setActiveStore } from "../useStoreTheme.js";
import {
  centsToUsd, costOf, fetchPricingAcross, isOwnCost, loadFrameCosts, loadPriceBand, marginPct,
  previewPriceBand, savePriceBand, savePricingOverride, savePricingRule, saveFrameCost, skuKey,
} from "./api.js";
import "./pricing-across.css";

/** La regla en UNA fila editable: modo, valor y guardar. */
function RuleRow({ scope, rule, store, onSaved, onError, t, lang }) {
  const [mode, setMode] = useState(rule ? rule.mode : "none");
  const [value, setValue] = useState(rule ? String(rule.value) : "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setMode(rule ? rule.mode : "none");
    setValue(rule ? String(rule.value) : "");
  }, [rule?.mode, rule?.value, scope, store]); // eslint-disable-line react-hooks/exhaustive-deps

  const now = !rule
    ? t("adm.price.frames.ruleNone")
    : rule.mode === "percent"
      ? t("adm.price.frames.rulePercent", { v: rule.value > 0 ? `+${rule.value}` : rule.value })
      : t("adm.price.frames.ruleDelta", { v: money(rule.value, "usd", lang) });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await savePricingRule({ scope, mode, value, store });
      onSaved(data);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pp-row" onSubmit={submit}>
      <label htmlFor={`pp-rule-${scope}`}>
        {t(scope === "case" ? "adm.price.frames.ruleCases" : "adm.price.frames.ruleFrames")}
        <HelpTip topic="price.rule" />
      </label>
      <span className="pp-now">{now}</span>
      {rule?.inherited && <span className="pp-badge inherit" title={t("adm.price.inheritedHint")}>{t("adm.price.inherited")}</span>}
      <select id={`pp-rule-${scope}`} className="pp-input" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="none">{t("adm.price.frames.mode.none")}</option>
        <option value="percent">{t("adm.price.frames.mode.percent")}</option>
        <option value="delta">{t("adm.price.frames.mode.delta")}</option>
      </select>
      {mode !== "none" && (
        <>
          <input
            className="pp-input pp-num"
            type="number"
            step="0.01"
            required
            aria-label={t("adm.price.frames.value")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <span className="pp-unit">{mode === "percent" ? "%" : "USD"}</span>
        </>
      )}
      <button className="btn-xs primary" disabled={busy}>{t("adm.price.save")}</button>
    </form>
  );
}

/**
 * SUELO Y TECHO del precio («la banda»), tal como lo pidió el dueño: si el
 * precio después de conversión queda por debajo de un umbral se lleva a una
 * cifra fija, y si queda por encima de otro se baja a un tope. Dos números por
 * lado — «menos de 30 vale 60» no se puede decir con uno solo.
 *
 * Mismas dos capas que todo lo demás del panel: con «Todas las tiendas» se
 * edita el MAESTRO (el dueño lo pone una vez para toda la cadena) y con una
 * tienda elegida arriba, SU variación, con la pastilla «Heredado» mientras no
 * maneje banda propia. Quitar la variación la devuelve a heredar.
 *
 * Y lo que no puede faltar: QUÉ LE PASA A LOS PRECIOS REALES ANTES DE GUARDAR.
 * Mientras se teclea, el servidor contesta (sin guardar) cuántos modelos sube
 * el suelo, cuántos baja el techo y algunos ejemplos con nombre y apellido
 * («READ 2: $8 → $60»). El dueño acaba de vivir que un cambio de regla le
 * moviera 147 precios: esto es para que no vuelva a pasar a ciegas.
 */
function BandBlock({ store, onError }) {
  const { t, lang } = useLang();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  const usd = (v) => money(Number(v) || 0, "usd", lang);
  // Lo que viene del servidor, en dólares y con la forma que edita la pantalla.
  const draftOf = (band) => ({
    enabled: band ? band.enabled !== false : true,
    floorBelow: centsToUsd(band?.floor_below_cents ?? null),
    floorTo: centsToUsd(band?.floor_to_cents ?? null),
    capAbove: centsToUsd(band?.cap_above_cents ?? null),
    capTo: centsToUsd(band?.cap_to_cents ?? null),
    applyToCases: Boolean(band?.apply_to_cases),
  });
  // El techo es un solo número para quien lo escribe: por dentro son dos
  // (umbral y destino) y se guardan iguales.
  const setCap = (e) => { const v = e.target.value; setDraft((d) => ({ ...d, capAbove: v, capTo: v })); };

  const sign = (d) => (d ? [d.enabled, d.floorBelow, d.floorTo, d.capAbove, d.capTo, d.applyToCases].join("|") : "");

  const reload = useCallback(async (force) => {
    const d = await loadPriceBand({ store, force });
    setData(d);
    // Con una tienda elegida que hereda, el formulario arranca con la banda del
    // maestro a la vista: es la que está rigiendo en ese mostrador.
    setDraft(draftOf(d.band));
    setPreview(null);
  }, [store]);

  useEffect(() => {
    let on = true;
    setData(null);
    setDraft(null);
    setPreview(null);
    loadPriceBand({ store }).then((d) => {
      if (!on) return;
      setData(d);
      setDraft(draftOf(d.band));
    });
    return () => { on = false; };
  }, [store]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vista previa del borrador, con freno: cada tecla no puede ser una petición.
  const saved = data?.band ?? null;
  const dirty = Boolean(draft) && sign(draft) !== sign(draftOf(saved));
  useEffect(() => {
    if (!draft || !dirty || data?.offline) { setPreview(null); return undefined; }
    let on = true;
    setChecking(true);
    const timer = setTimeout(() => {
      previewPriceBand({ band: draft, store })
        .then((r) => { if (on) { setPreview(r.impact); setChecking(false); } })
        // Un borrador inválido (medio lado, o el suelo por encima del techo) no
        // es un error que interrumpa: se dice al intentar guardar.
        .catch(() => { if (on) { setPreview(null); setChecking(false); } });
    }, 450);
    return () => { on = false; clearTimeout(timer); setChecking(false); };
  }, [sign(draft), dirty, store, data?.offline]); // eslint-disable-line react-hooks/exhaustive-deps

  const write = async (clear) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await savePriceBand({ band: draft, store, clear });
      setData({ ...r, offline: false });
      setDraft(draftOf(r.band));
      setPreview(null);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const inStore = Boolean(store && store !== "all" && store !== "web");
  const inherited = inStore && data?.inherited !== false && !data?.offline;
  const impact = preview ?? data?.impact ?? null;
  const can = Boolean(draft) && !data?.offline && !busy;
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value.replace(/[^0-9.]/g, "") }));

  return (
    <div className="pp-block">
      <h4>
        {t(inStore ? "adm.price.frames.band.titleStore" : "adm.price.frames.band.title")}
        <small>{t("adm.price.frames.band.sub")}</small>
      </h4>

      {data?.offline && (
        <p className="pp-cover bad"><Icon name="alert" size={13} /> {t("adm.price.frames.band.offline")}</p>
      )}

      {draft && (
        <>
          <div className="pp-row">
            <label className="pp-lbl" htmlFor="pp-band-on">
              <input
                id="pp-band-on"
                type="checkbox"
                disabled={!can}
                checked={draft.enabled}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
              />
              {" "}{t("adm.price.frames.band.enabled")}
            </label>
            {inherited && (
              <span className="pp-badge inherit" title={t("adm.price.frames.band.inheritHint")}>
                {t("adm.price.inherited")}
              </span>
            )}
            {!inherited && inStore && !data?.offline && (
              <span className="pp-badge" title={t("adm.price.frames.band.storeHint")}>
                {t("adm.price.frames.band.storeBadge")}
              </span>
            )}
            {!draft.enabled && <span className="pp-now">{t("adm.price.frames.band.offHint")}</span>}
          </div>

          {/* El suelo: «por debajo de X, llévalo a Y». */}
          <div className="pp-row">
            <label className="pp-lbl" htmlFor="pp-band-floor-below">{t("adm.price.frames.band.floorBelow")}</label>
            <input
              id="pp-band-floor-below"
              className="pp-input pp-num"
              inputMode="decimal"
              disabled={!can}
              aria-label={t("adm.price.frames.band.floorBelowAria")}
              value={draft.floorBelow}
              onChange={set("floorBelow")}
            />
            <span className="pp-unit">USD</span>
            <label className="pp-lbl" htmlFor="pp-band-floor-to">{t("adm.price.frames.band.floorTo")}</label>
            <input
              id="pp-band-floor-to"
              className="pp-input pp-num"
              inputMode="decimal"
              disabled={!can}
              aria-label={t("adm.price.frames.band.floorToAria")}
              value={draft.floorTo}
              onChange={set("floorTo")}
            />
            <span className="pp-unit">USD</span>
          </div>

          {/* El techo: UN solo número. El dueño lo dijo así — «que no sobrepase
              100» —, no «por encima de X bájalo a Y». El esquema guarda umbral
              y destino por separado, así que aquí se escriben los dos iguales:
              nada por encima de ese número. Pedirle la misma cifra dos veces
              solo añade una forma de equivocarse. */}
          <div className="pp-row">
            <label className="pp-lbl" htmlFor="pp-band-cap">{t("adm.price.frames.band.cap")}</label>
            <input
              id="pp-band-cap"
              className="pp-input pp-num"
              inputMode="decimal"
              disabled={!can}
              aria-label={t("adm.price.frames.band.capAria")}
              value={draft.capAbove}
              onChange={setCap}
            />
            <span className="pp-unit">USD</span>
          </div>

          {/* Los estuches, con el número delante: por defecto se quedan fuera
              porque un estuche de $0,98 se vende a $5 y el suelo lo pondría a
              $60. Es un interruptor, no una decisión escondida. */}
          <div className="pp-row">
            <label className="pp-lbl" htmlFor="pp-band-cases">
              <input
                id="pp-band-cases"
                type="checkbox"
                disabled={!can}
                checked={draft.applyToCases}
                onChange={(e) => setDraft((d) => ({ ...d, applyToCases: e.target.checked }))}
              />
              {" "}{t("adm.price.frames.band.cases")}
            </label>
            <span className="pp-now">
              {draft.applyToCases
                ? t("adm.price.frames.band.casesIn")
                : t("adm.price.frames.band.casesOut", { n: impact?.cases_would_raise ?? 0 })}
            </span>
          </div>

          {/* QUÉ LE PASA A LOS PRECIOS. Lo último antes de los botones, a
              propósito: es lo que hay que leer antes de pulsar «Guardar». */}
          <p className={`pp-cover ${impact && (impact.raised || impact.lowered) ? "bad" : "ok"}`}>
            <Icon name={impact && (impact.raised || impact.lowered) ? "alert" : "checkCircle"} size={13} />
            {checking
              ? t("adm.price.frames.band.checking")
              : !impact
                ? t("adm.price.frames.band.noImpact")
                : t(dirty ? "adm.price.frames.band.impactDraft" : "adm.price.frames.band.impactSaved", {
                  raised: impact.raised,
                  lowered: impact.lowered,
                  unchanged: impact.unchanged,
                })}
            {impact?.owner_priced > 0 && (
              <span className="pp-badge" title={t("adm.price.frames.band.ownPricedHint")}>
                {t("adm.price.frames.band.ownPriced", { n: impact.owner_priced })}
              </span>
            )}
          </p>

          {!checking && impact && (impact.examples?.raised?.length > 0 || impact.examples?.lowered?.length > 0) && (
            <ul className="pp-matches">
              {[...(impact.examples.raised || []), ...(impact.examples.lowered || [])].map((ex) => (
                <li key={`${ex.model}:${ex.from}:${ex.to}`}>
                  <span className="adm-chip">
                    {t("adm.price.frames.band.example", { model: ex.model, from: usd(ex.from), to: usd(ex.to) })}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="pp-row">
            <button type="button" className="btn-xs primary" disabled={!can || !dirty} onClick={() => write(false)}>
              {t(inStore ? "adm.price.frames.band.saveStore" : "adm.price.save")}
            </button>
            {(inStore ? !inherited : Boolean(saved)) && !data?.offline && (
              <button
                type="button"
                className="btn-xs warn"
                disabled={!can}
                title={t(inStore ? "adm.price.frames.band.clearStore" : "adm.price.frames.band.clear")}
                onClick={() => write(true)}
              >
                <Icon name="undo" size={12} /> {t(inStore ? "adm.price.frames.band.clearStore" : "adm.price.frames.band.clear")}
              </button>
            )}
            {dirty && (
              <button type="button" className="btn-xs" disabled={busy} onClick={() => reload(true)}>
                {t("adm.price.frames.band.discard")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * El margen que sale del costo y del precio. Sin costo conocido NO pinta un
 * «0 %»: pinta que falta el costo, y se destaca, porque es el modelo que hace
 * que la contabilidad del mes no cuadre.
 */
function Margin({ price, cost }) {
  const { t } = useLang();
  if (cost == null) {
    return (
      <span className="pp-nocost" title={t("adm.price.frames.cost.missingHint")}>
        <Icon name="alert" size={11} /> {t("adm.price.frames.cost.missing")}
      </span>
    );
  }
  const pct = marginPct(price, cost);
  // Hay costo pero no se conoce el precio de venta de este modelo: el margen no
  // se puede saber desde aquí, y decir «0 %» sería peor que decir nada.
  if (pct == null) return <span className="pp-now" title={t("adm.price.frames.cost.noPriceHint")}>{t("adm.price.frames.cost.noMargin")}</span>;
  const tone = pct >= 50 ? "good" : pct >= 30 ? "warn" : "bad";
  return (
    <b className={`pp-mg ${tone}`} title={t("adm.price.frames.cost.marginHint")}>
      {t("adm.price.frames.cost.marginPct", { v: pct })}
    </b>
  );
}

/**
 * Costo de un modelo, editable: escribir, guardar, y un botón para devolverlo
 * a la capa de arriba — el MISMO gesto que el precio.
 *
 * `store` es el alcance: "all" escribe el maestro (lo que paga la cadena) y un
 * id de tienda escribe LA VARIACIÓN de esa tienda. Con una tienda abierta la
 * cifra grande es la de la tienda; si la hereda, se dice con la pastilla
 * «Heredado» y el botón de deshacer no aparece (no hay nada propio que quitar),
 * y si es propia se enseña el maestro al lado para poder comparar las dos.
 *
 * Los dos botones son `type="button"` a propósito: este campo también vive
 * dentro del <form> del precio exacto y no debe enviarlo. La escritura va por
 * SKU (así la acepta el servidor), no por el id de Medusa.
 */
function CostField({ sku, name, cost, store = "all", onSaved, onError }) {
  const { t, lang } = useLang();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const usd = (c) => money(c / 100, "usd", lang);
  const cents = cost?.cents ?? null;
  const own = Boolean(cost?.own);
  // Alcance de tienda: lo dice el descriptor (de dónde se leyó), no el prop,
  // para que no se pinte «Heredado» sobre cifras que son del maestro.
  const inStore = Boolean(cost?.store);
  const storeOwn = Boolean(cost?.storeOwn);
  const inherited = inStore && Boolean(cost?.inherited);
  const masterCents = cost?.masterCents ?? null;
  // Sin SKU no hay a qué escribirle; `editable: false` = el servidor no
  // contestó y lo que se ve es el respaldo del navegador (no se puede guardar).
  const can = Boolean(sku) && cost?.editable !== false && !busy;
  const valueHint = storeOwn
    ? t("adm.price.frames.cost.storeHint")
    : own
      ? t("adm.price.frames.cost.ownHint")
      : t("adm.price.frames.cost.listHint");

  const write = async (value) => {
    setBusy(true);
    try {
      await saveFrameCost({ sku, costUsd: value, store });
      setDraft("");
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="pp-cost">
      {cents == null
        ? <span className="pp-now">{t("adm.price.none")}</span>
        : <b className={`pp-cost-v ${own ? "own" : ""}`} title={valueHint}>{usd(cents)}</b>}
      {storeOwn && <span className="pp-badge" title={t("adm.price.frames.cost.storeHint")}>{t("adm.price.frames.cost.storeBadge")}</span>}
      {!inStore && own && <span className="pp-badge" title={t("adm.price.frames.cost.ownHint")}>{t("adm.price.frames.cost.ownBadge")}</span>}
      {inherited && <span className="pp-badge inherit" title={t("adm.price.frames.cost.inheritHint")}>{t("adm.price.inherited")}</span>}
      {/* Las dos cifras juntas: con costo propio de tienda, el maestro al lado
          para saber de qué se está separando esta tienda. */}
      {storeOwn && masterCents != null && (
        <span className="pp-now" title={t("adm.price.frames.cost.masterHint")}>
          {t("adm.price.frames.cost.master", { v: usd(masterCents) })}
        </span>
      )}
      <input
        className="pp-input pp-num"
        inputMode="decimal"
        placeholder={t("adm.price.frames.cost.placeholder")}
        aria-label={t(inStore ? "adm.price.frames.cost.ariaStore" : "adm.price.frames.cost.aria", { name })}
        title={t(inStore ? "adm.price.frames.cost.ariaStore" : "adm.price.frames.cost.aria", { name })}
        disabled={!can}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
      />
      <button
        type="button"
        className="btn-xs primary"
        disabled={!can || !draft}
        title={t(inStore ? "adm.price.frames.cost.saveStore" : "adm.price.frames.cost.save", { name })}
        aria-label={t(inStore ? "adm.price.frames.cost.saveStore" : "adm.price.frames.cost.save", { name })}
        onClick={() => write(draft)}
      >
        <Icon name="save" size={12} />
      </button>
      {/* Deshacer solo cuando hay algo propio que quitar: en el maestro, la
          edición del dueño; en una tienda, su variación. */}
      {(inStore ? storeOwn : own) && (
        <button
          type="button"
          className="btn-xs"
          disabled={!can}
          title={t(inStore ? "adm.price.frames.cost.clearStore" : "adm.price.frames.cost.clear", { name })}
          aria-label={t(inStore ? "adm.price.frames.cost.clearStore" : "adm.price.frames.cost.clear", { name })}
          onClick={() => write(null)}
        >
          <Icon name="undo" size={12} />
        </button>
      )}
    </span>
  );
}

/** Buscador del catálogo del SERVIDOR + costo y precio exactos del modelo elegido. */
function OverrideForm({ store, storeId, costs, onCostSaved, onSaved, onError, t }) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState([]);
  const [picked, setPicked] = useState(null);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  // El buscador de productos cuelga de una tienda (GET
  // /admin/store-assortment/:id/products). Con «Todas las tiendas» el panel
  // pasa la primera tienda solo para LEER el catálogo: los modelos son los
  // mismos; lo que cambia es dónde se guarda el precio (`store`).
  const searchIn = storeId;

  // El costo se guarda por SKU y la respuesta del catálogo ya lo trae (`sku`,
  // el del primer color del modelo). Por el nombre del modelo solo si un modelo
  // no tuviera SKU, contra el `model` de la lista de costos.
  const pickedSku = picked ? picked.sku || picked.title : null;
  const pickedCost = picked && costs ? costOf(costs, { sku: picked.sku, name: picked.title }) : null;
  const pickedCostUsd = pickedCost?.cents != null ? pickedCost.cents / 100 : null;

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2 || picked || !searchIn) { setMatches([]); return undefined; }
    let on = true;
    const timer = setTimeout(() => {
      searchStoreCatalog(searchIn, { q: s, limit: 8 })
        .then((r) => { if (on) setMatches(r.products || []); })
        .catch(() => { if (on) setMatches([]); });
    }, 250);
    return () => { on = false; clearTimeout(timer); };
  }, [searchIn, q, picked]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !picked) return;
    setBusy(true);
    try {
      const data = await savePricingOverride({
        productId: picked.id,
        price,
        kind: picked.is_case ? "case" : "frame",
        store,
      });
      setPicked(null);
      setQ("");
      setPrice("");
      onSaved(data);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pp-block" onSubmit={submit}>
      <h4>
        {t("adm.price.frames.exactPrice")}
        <HelpTip topic="price.override" />
        <small>{t("adm.price.frames.searchHint")}</small>
      </h4>
      <label className="pp-search">
        <Icon name="search" size={14} />
        <input
          aria-label={t("adm.price.frames.search")}
          placeholder={t("adm.price.frames.search")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setPicked(null); }}
        />
      </label>
      {!picked && q.trim().length >= 2 && (
        <ul className="pp-matches">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="btn-xs" onClick={() => { setPicked(p); setQ(p.title); }}>
                {p.title}{p.brand ? ` · ${p.brand}` : ""}{p.sku ? <> <code className="pp-sku">{p.sku}</code></> : null}
              </button>
            </li>
          ))}
          {!matches.length && <li className="pp-empty">{t("adm.price.frames.searchEmpty")}</li>}
        </ul>
      )}
      {picked && (
        <div className="pp-row">
          <span className="pp-now">{t("adm.price.frames.picked", { name: picked.title })}</span>
          {/* Costo y precio del MISMO modelo, uno al lado del otro, y el margen
              que sale de los dos: el margen sigue al precio que se está
              escribiendo, no hay que guardar para verlo. */}
          {costs && (
            <>
              <label className="pp-lbl">{t("adm.price.frames.cost.col.cost")}</label>
              <CostField sku={pickedSku} name={picked.title} cost={pickedCost} store={store} onSaved={onCostSaved} onError={onError} />
            </>
          )}
          <label className="pp-lbl" htmlFor="pp-exact-price">{t("adm.price.frames.exactPrice")}</label>
          <input
            id="pp-exact-price"
            className="pp-input pp-num wide"
            type="number"
            step="0.01"
            min="0"
            required
            aria-label={t("adm.price.frames.exactPrice")}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <span className="pp-unit">USD</span>
          {costs && <Margin price={price} cost={pickedCostUsd} />}
          <button className="btn-xs primary" disabled={busy}>{t("adm.price.save")}</button>
          <button type="button" className="btn-xs" onClick={() => { setPicked(null); setQ(""); }}>{t("adm.price.remove")}</button>
        </div>
      )}
    </form>
  );
}

/**
 * El costo de proveedor de TODO el catálogo, con el aviso que el dueño pidió
 * arriba: cuántos modelos tienen costo y cuántos no, y un atajo para quedarse
 * solo con los que faltan — así los dos estuches sin costo se encuentran de un
 * clic en vez de mirándolos uno a uno.
 *
 * El precio de venta de cada fila lo manda el servidor en la propia fila
 * (`price_cents`: el precio actual del alcance leído, el mismo que cobra la
 * caja — catalogSellingPrices en lib/frame-cost.ts). Si una versión del
 * servidor aún no lo trae, se cruza por SKU (y por nombre de modelo) con los
 * modelos de precio propio, los únicos cuyo precio conoce esta pantalla; para
 * el resto se dice que sigue la regla en vez de inventarlo.
 */
function CostsBlock({ costs, overrides, store = "all", onCostSaved, onError }) {
  const { t, lang } = useLang();
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [q, setQ] = useState("");

  const priceOf = useMemo(() => {
    const m = new Map();
    for (const o of overrides || []) {
      const p = Number(o.price);
      if (!Number.isFinite(p)) continue;
      for (const k of [skuKey(o.sku), skuKey(o.title)]) if (k && !m.has(k)) m.set(k, p);
    }
    return m;
  }, [overrides]);

  // `cost` es el costo EFECTIVO del alcance leído (el maestro, o lo que paga la
  // tienda abierta) y `master` el de la cadena: el margen de la fila sale del
  // efectivo, que es el que de verdad se cobra en ese mostrador.
  const rows = useMemo(() => (costs?.rows || []).map((r) => {
    const cost = r.cost_cents == null ? null : r.cost_cents / 100;
    const masterCents = r.master_cost_cents ?? r.cost_cents;
    const price = r.price_cents != null ? r.price_cents / 100 : priceOf.get(skuKey(r.sku)) ?? priceOf.get(skuKey(r.model)) ?? null;
    return {
      ...r,
      cost,
      master: masterCents == null ? null : masterCents / 100,
      book: r.book_cents == null ? null : r.book_cents / 100,
      price,
      margin: cost == null ? null : marginPct(price, cost),
    };
  }), [costs, priceOf]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((r) => {
    if (onlyMissing && r.cost != null) return false;
    if (!needle) return true;
    return `${r.model || ""} ${r.sku || ""}`.toLowerCase().includes(needle);
  }), [rows, onlyMissing, needle]);

  const withCost = costs?.summary?.with_cost ?? null;
  const without = costs?.summary?.without_cost ?? null;
  // Con una tienda abierta: cuántos modelos maneja ELLA aparte del maestro.
  const inStore = Boolean(costs?.store);
  const variations = inStore ? costs?.summary?.store_variations ?? 0 : 0;

  const cols = useMemo(() => [
    {
      key: "model",
      header: t("adm.price.frames.cost.col.model"),
      essential: true,
      minWidth: 170,
      text: (r) => r.model || r.sku,
      render: (r) => <><b>{r.model || r.sku}</b> <code className="pp-sku">{r.sku}</code></>,
      sortValue: (r) => String(r.model || r.sku || ""),
    },
    { key: "book", header: t("adm.price.frames.cost.col.book"), type: "money" },
    // El maestro solo cuando hay una tienda abierta: con «Todas las tiendas» la
    // columna «Costo» YA es el maestro y repetirlo sería ruido.
    ...(inStore
      ? [{
        key: "master",
        header: t("adm.price.frames.cost.col.master"),
        type: "money",
        essential: true,
        text: (r) => (r.master == null ? "" : String(r.master)),
        render: (r) => (r.master == null
          ? <span className="pp-now">{t("adm.price.none")}</span>
          : <span className="pp-now" title={t("adm.price.frames.cost.masterHint")}>{money(r.master, "usd", lang)}</span>),
        sortValue: (r) => (r.master == null ? -1 : r.master),
      }]
      : []),
    {
      key: "cost",
      header: t(inStore ? "adm.price.frames.cost.col.costStore" : "adm.price.frames.cost.col.cost"),
      type: "money",
      essential: true,
      minWidth: 240,
      // Editable en la propia fila: es donde el dueño está mirando el agujero.
      render: (r) => (
        <CostField
          sku={r.sku}
          name={r.model || r.sku}
          store={store}
          cost={{
            cents: r.cost_cents ?? null,
            own: !costs?.offline && isOwnCost(r.origin || r.source),
            storeOwn: !costs?.offline && (r.origin || r.source) === "store_variation",
            inherited: inStore && r.inherited !== false,
            masterCents: r.master_cost_cents ?? r.cost_cents ?? null,
            store: costs?.store || null,
            editable: !costs?.offline,
          }}
          onSaved={onCostSaved}
          onError={onError}
        />
      ),
      // Los que faltan primero al ordenar por costo: son la tarea pendiente.
      sortValue: (r) => (r.cost == null ? -1 : r.cost),
    },
    {
      key: "price",
      header: t("adm.price.frames.cost.col.price"),
      type: "money",
      essential: true,
      // `price_source` lo manda el servidor con el precio (catalogSellingPrices):
      // en el maestro, «regla general» cuando la regla sin tienda lo movió, para
      // que se vea que el maestro ya la lleva (es el precio del que parte cada
      // tienda); «base» no se etiqueta.
      render: (r) => (r.price == null
        ? <span className="pp-now" title={t("adm.price.frames.cost.noPriceHint")}>{t("adm.price.frames.cost.noPrice")}</span>
        : <span className="pp-price-src" title={r.price_source && r.price_source !== "base" ? t(`adm.price.across.srcHint.${r.price_source}`) : undefined}>
            <b>{money(r.price, "usd", lang)}</b>
            {r.price_source && r.price_source !== "base" && <span className={`pp-across-src ${r.price_source}`}>{t(`adm.price.across.src.${r.price_source}`)}</span>}
          </span>),
      sortValue: (r) => (r.price == null ? -1 : r.price),
    },
    {
      key: "margin",
      header: t("adm.price.frames.cost.col.margin"),
      essential: true,
      align: "r",
      text: (r) => (r.cost == null ? t("adm.price.frames.cost.missing") : r.margin == null ? "" : `${r.margin} %`),
      render: (r) => <Margin price={r.price} cost={r.cost} />,
      sortValue: (r) => (r.cost == null ? -1000 : r.margin ?? -999),
    },
    { key: "updated_at", header: t("adm.price.frames.cost.col.since"), type: "date", hiddenByDefault: true },
  ], [t, lang, costs, store, inStore, onCostSaved, onError]);

  return (
    <div className="pp-block">
      <h4>
        {t(inStore ? "adm.price.frames.cost.titleStore" : "adm.price.frames.cost.title")}
        <small>{t(inStore ? "adm.price.frames.cost.subStore" : "adm.price.frames.cost.sub")}</small>
      </h4>

      {/* El aviso que el dueño tiene que ver sin buscarlo. Mientras el servidor
          no conteste no se dice nada: no se sabe todavía. */}
      {!costs ? null : costs.offline
        ? <p className="pp-cover bad"><Icon name="alert" size={13} /> {t("adm.price.frames.cost.offline")}</p>
        : (
          <p className={`pp-cover ${without ? "bad" : "ok"}`}>
            <Icon name={without ? "alert" : "checkCircle"} size={13} />
            {without
              ? t("adm.price.frames.cost.coverage", { withCost, without })
              : t("adm.price.frames.cost.allCovered", { withCost })}
            {inStore && (
              <span className="pp-badge" title={t("adm.price.frames.cost.variationsHint")}>
                {t("adm.price.frames.cost.variations", { n: variations })}
              </span>
            )}
            {without > 0 && (
              <button
                type="button"
                className={`btn-xs ${onlyMissing ? "primary" : ""}`}
                aria-pressed={onlyMissing}
                title={t(onlyMissing ? "adm.price.frames.cost.showAll" : "adm.price.frames.cost.onlyMissing")}
                onClick={() => setOnlyMissing((v) => !v)}
              >
                {t(onlyMissing ? "adm.price.frames.cost.showAll" : "adm.price.frames.cost.onlyMissing")}
              </button>
            )}
          </p>
        )}

      <DataTable
        id="pricing-frame-costs"
        cols={cols}
        rows={shown}
        rowKey={(r) => r.sku}
        rowClass={(r) => (r.cost == null ? "pp-missing" : "")}
        dense
        maxHeight="46vh"
        emptyIcon="prices"
        emptyText={t(onlyMissing ? "adm.price.frames.cost.noneMissing" : "adm.price.frames.cost.empty")}
        defaultSort={{ key: "margin", dir: "asc" }}
      >
        <label className="pp-search compact">
          <Icon name="search" size={13} />
          <input
            aria-label={t("adm.price.frames.cost.filter")}
            placeholder={t("adm.price.frames.cost.filter")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </DataTable>
    </div>
  );
}

/**
 * UN MODELO EN TODAS LAS TIENDAS (HU-13). «Como dueño, quiero ver un producto
 * con su precio en todas las tiendas.» Todo lo demás del panel se lee tienda a
 * tienda; aquí se busca un modelo (o un SKU) y sale UNA fila por modelo con una
 * columna por tienda activa: lo que cobra esa caja hoy, con la etiqueta de por
 * qué (exacto / banda / ajuste / base) y «oculto» cuando la tienda no vende el
 * modelo. Las cifras vienen del servidor con la MISMA función del POS (nunca se
 * calcula nada aquí). El costo solo llega con permiso de costos — sin él, la
 * clave ni existe en la respuesta — y la columna aparece solo entonces.
 *
 * Mismo buscador que el precio exacto (freno de 300 ms, secuencia que descarta
 * respuestas viejas). Clic en una celda = elegir esa tienda en el selector
 * global (`setActiveStore`), que es como el panel entero salta a sus precios.
 */
function AcrossBlock({ onError }) {
  const { t, lang } = useLang();
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const usd = (c) => money(c / 100, "usd", lang);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setData(null); setBusy(false); return undefined; }
    let on = true;
    setBusy(true);
    const timer = setTimeout(() => {
      fetchPricingAcross(s)
        .then((r) => { if (on) { setData(r); setBusy(false); } })
        .catch((err) => { if (on) { setData(null); setBusy(false); onError(err.message); } });
    }, 300);
    return () => { on = false; clearTimeout(timer); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const stores = data?.stores || [];
  const rows = data?.rows || [];
  const costAccess = Boolean(data?.cost_access);

  /** Precio + etiqueta de origen; `onPick` lo vuelve botón (abre esa tienda). */
  const cell = (priceCents, source, { hidden = false, storeCode = null, onPick = null, extraTitle = "" } = {}) => {
    const src = source ? t(`adm.price.across.src.${source}`) : "";
    const why = source ? t(`adm.price.across.srcHint.${source}`) : "";
    const title = [onPick ? t("adm.price.across.cellHint", { code: storeCode }) : "", why, hidden ? t("adm.price.across.hiddenHint") : "", extraTitle].filter(Boolean).join(" · ");
    const body = (
      <>
        {priceCents == null ? <span className="pp-now">{t("adm.price.across.noPrice")}</span> : <b>{usd(priceCents)}</b>}
        <span>
          {source && <span className={`pp-across-src ${source}`}>{src}</span>}
          {hidden && <> <span className="pp-across-hidden">{t("adm.price.across.hidden")}</span></>}
        </span>
      </>
    );
    return onPick
      ? <button type="button" className={`pp-across-cell ${hidden ? "off" : ""}`} title={title} onClick={onPick}>{body}</button>
      : <span className={`pp-across-cell static ${hidden ? "off" : ""}`} title={title}>{body}</span>;
  };

  return (
    <div className="pp-block">
      <h4>
        {t("adm.price.across.title")}
        <small>{t("adm.price.across.sub")}</small>
      </h4>
      <label className="pp-search">
        <Icon name="search" size={14} />
        <input
          aria-label={t("adm.price.across.search")}
          placeholder={t("adm.price.across.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      {q.trim().length < 2 && <p className="pp-hint">{t("adm.price.across.hint")}</p>}
      {busy && <p className="pp-hint">{t("adm.price.across.searching")}</p>}
      {!busy && data && !rows.length && <p className="pp-hint">{t("adm.price.across.empty")}</p>}
      {!busy && data && rows.length > 0 && !stores.length && <p className="pp-hint">{t("adm.price.across.noStores")}</p>}
      {!busy && data?.truncated && <p className="pp-hint">{t("adm.price.across.truncated", { n: data.limit })}</p>}

      {!busy && rows.length > 0 && (
        <div className="pp-across-wrap">
          <table className="pp-across">
            <thead>
              <tr>
                <th>{t("adm.price.across.col.model")}</th>
                {costAccess && <th className="num" title={t("adm.price.across.costHint")}>{t("adm.price.across.col.cost")}</th>}
                <th className="num" title={t("adm.price.across.masterHint")}>{t("adm.price.across.col.master")}</th>
                {stores.map((s) => (
                  <th key={s.id} className="num" title={t("adm.price.across.storeHint", { code: s.code, name: s.name })}>
                    <span className="pp-across-store">
                      <span className="pp-across-dot" style={{ background: s.color || "var(--adm-line)" }} />
                      {s.code}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td className="pp-across-model-td" data-label={t("adm.price.across.col.model")}>
                    <span className="pp-across-model">
                      {r.thumbnail && <img className="pp-across-thumb" src={r.thumbnail} alt="" loading="lazy" />}
                      <span className="pp-across-name">
                        <b>{r.title}{r.is_case && <> <span className="pp-badge">{t("adm.price.across.case")}</span></>}</b>
                        <span>
                          <code className="pp-sku">{r.sku}</code>
                          {r.skus?.length > 1 && <span className="pp-now"> · {t("adm.price.across.colors", { n: r.skus.length })}</span>}
                        </span>
                      </span>
                    </span>
                  </td>
                  {costAccess && (
                    <td className="num" data-label={t("adm.price.across.col.cost")}>
                      {r.cost_cents == null
                        ? <span className="pp-nocost" title={t("adm.price.frames.cost.missingHint")}><Icon name="alert" size={11} /> {t("adm.price.frames.cost.missing")}</span>
                        : <span className="pp-cost-v" title={t("adm.price.across.costHint")}>{usd(r.cost_cents)}</span>}
                    </td>
                  )}
                  <td className="num" data-label={t("adm.price.across.col.master")}>
                    {/* `master_source` viene del servidor (lib/store-pricing.ts masterLinePrice): propio / banda / regla general / base. */}
                    {cell(r.master_price_cents, r.master_source || "base")}
                  </td>
                  {stores.map((s) => {
                    const c = (r.stores || []).find((x) => x.establishment_id === s.id);
                    if (!c) return <td key={s.id} className="num" data-label={s.code} />;
                    const ownCost = costAccess && c.cost_cents != null && c.cost_cents !== r.cost_cents
                      ? t("adm.price.across.costStore", { v: usd(c.cost_cents) })
                      : "";
                    return (
                      <td key={s.id} className="num" data-label={s.code}>
                        {cell(c.price_cents, c.source, { hidden: !c.exposed, storeCode: s.code, onPick: () => setActiveStore(s.id), extraTitle: ownCost })}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FramesSection({ frames, store, storeId, onSaved, onError }) {
  const { t, lang } = useLang();
  const [busy, setBusy] = useState("");
  // Los costos cuelgan del ALCANCE elegido arriba, igual que las reglas y los
  // precios: «Todas las tiendas» es el maestro y una tienda trae lo que paga
  // ella con el maestro al lado. Cambian cuando llega lista nueva, así que la
  // lectura va cacheada con TTL largo y con una entrada por tienda — la misma
  // que usa la pantalla «Productos».
  const [costs, setCosts] = useState(null);
  const reloadCosts = useCallback(() => loadFrameCosts({ force: true, store }).then(setCosts), [store]);
  useEffect(() => {
    let on = true;
    // Cambiar de tienda invalida lo que se estaba viendo: mientras llega lo
    // nuevo no se enseña el costo de la otra tienda.
    setCosts(null);
    loadFrameCosts({ store }).then((d) => { if (on) setCosts(d); });
    return () => { on = false; };
  }, [store]);
  // Guardar un costo no cambia nada del `overview`, así que se avisa con un
  // `slice` vacío: el panel enseña su «Guardado.» y no fusiona datos ajenos.
  const onCostSaved = useCallback(() => { reloadCosts(); onSaved({}); }, [reloadCosts, onSaved]);

  const remove = async (row) => {
    if (busy) return;
    setBusy(row.product_id);
    try {
      onSaved(await savePricingOverride({ productId: row.product_id, price: null, kind: row.kind, store }));
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy("");
    }
  };

  const cols = useMemo(() => [
    { key: "title", header: t("adm.price.frames.col.title"), essential: true, minWidth: 180 },
    { key: "kind", header: t("adm.price.frames.col.kind"), type: "chip", essential: true, text: (r) => t(`adm.price.frames.kind.${r.kind}`), render: (r) => <span className="adm-chip">{t(`adm.price.frames.kind.${r.kind}`)}</span> },
    { key: "brand", header: t("adm.price.frames.col.brand"), hiddenByDefault: true },
    { key: "sku", header: t("adm.price.frames.col.sku"), hiddenByDefault: true },
    { key: "base", header: t("adm.price.frames.col.base"), type: "money" },
    {
      key: "price",
      header: t("adm.price.frames.col.price"),
      type: "money",
      essential: true,
      render: (r) => (
        <>
          <b>{money(r.price, "usd", lang)}</b>
          {r.inherited && <span className="pp-badge inherit" title={t("adm.price.inheritedHint")}> {t("adm.price.inherited")}</span>}
        </>
      ),
    },
    { key: "since", header: t("adm.price.frames.col.since"), type: "date", essential: true },
    { key: "by", header: t("adm.price.frames.col.by"), hiddenByDefault: true },
    {
      key: "act",
      header: "",
      type: "action",
      always: true,
      export: false,
      render: (r) => (
        <button type="button" className="btn-xs warn" disabled={busy === r.product_id || r.inherited} onClick={() => remove(r)}>
          {t("adm.price.remove")}
        </button>
      ),
    },
  ], [t, lang, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <RuleRow scope="frame" rule={frames.rule} store={store} onSaved={onSaved} onError={onError} t={t} lang={lang} />
      <RuleRow scope="case" rule={frames.case_rule} store={store} onSaved={onSaved} onError={onError} t={t} lang={lang} />
      <BandBlock store={store} onError={onError} />
      <OverrideForm
        store={store}
        storeId={storeId}
        costs={costs}
        onCostSaved={onCostSaved}
        onSaved={onSaved}
        onError={onError}
        t={t}
      />
      <CostsBlock costs={costs} overrides={frames.overrides} store={store} onCostSaved={onCostSaved} onError={onError} />
      <AcrossBlock onError={onError} />
      <div className="pp-block">
        <h4>
          {t("adm.price.frames.modified")}
          <small>{t("adm.price.frames.modifiedSub")}</small>
        </h4>
        <DataTable
          id="pricing-overrides"
          cols={cols}
          rows={frames.overrides}
          rowKey={(r) => `${r.kind}:${r.product_id}`}
          dense
          maxHeight="46vh"
          emptyIcon="prices"
          emptyText={t("adm.price.frames.empty")}
          bar={frames.overrides.length > 0}
        />
      </div>
    </>
  );
}
