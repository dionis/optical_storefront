// Dónde se usa: «Precios y costos» → pestaña «Tratamientos».
//
// Lo que se le AÑADE al lente, que el dueño pidió ver aparte de los diseños:
// los fotocromáticos (y Transitions) por categoría de diseño, y los
// antirreflejos en sus grupos. Antes colgaban del mismo bloque que la matriz y
// había que bajar toda la matriz para llegar.
//
// Las dos tablas van una al lado de la otra: son cortas y así se ven enteras
// sin bajar, que es justo lo que se pidió. El «% sobre el maestro» de la tienda
// se repite aquí porque también manda sobre estos precios.
import { useLang } from "../../i18n/LanguageContext.jsx";
import { money } from "../adminOrders.js";
import HelpTip from "../HelpTip.jsx";
import { AdjustRow, Cell, labelOf, useLensWriter } from "./lensShared.jsx";

/** Las tres categorías de diseño que cobran fotocromático, en orden de venta. */
const CATS = ["sv", "bifocal", "prog"];
/** Los grupos de antirreflejo que maneja la lista; el resto cae en «todos». */
const AR_GROUPS = ["sv", "bifprog", "all"];
const arGroupOf = (a) => (AR_GROUPS.includes(a.ar_group) ? a.ar_group : "all");

export default function TreatmentsSection({ lenses, store, onSaved, onError }) {
  const { t, lang } = useLang();
  const { save, isOwn, isStore } = useLensWriter({ lenses, store, onSaved, onError });

  return (
    <>
      {/* Sin tienda elegida no hay porcentaje que mover: la barra no se pinta
          para no dejar un hueco antes de las tablas. */}
      {lenses.store && (
        <div className="pp-bar">
          <AdjustRow lenses={lenses} store={store} onSaved={onSaved} onError={onError} id="pp-treat-adjust" />
        </div>
      )}

      <div className="pp-two">
        <section className="pp-pane">
          <h3>
            <span className="pp-pane-t">{t("adm.price.lenses.photo")}</span>
            <HelpTip topic="price.photo" />
          </h3>
          <div className="pp-grid-wrap">
            <table className="pp-grid">
              <thead>
                <tr>
                  <th>{t("adm.price.treat.photoCol")}</th>
                  {CATS.map((c) => <th key={c}>{t(`adm.price.lenses.cat.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {lenses.photo.map((p) => (
                  <tr key={p.code}>
                    <th scope="row">{labelOf(p, lang)}</th>
                    {CATS.map((cat) => {
                      const master = p[cat];
                      if (master == null) {
                        return <td key={cat}><span className="pp-cell na" title={t("adm.price.lenses.na")}>{t("adm.price.lenses.na")}</span></td>;
                      }
                      const key = `${p.code}:${cat}`;
                      const shown = isStore ? (p.store?.[cat] ?? master) : master;
                      return (
                        <td key={cat}>
                          <Cell
                            cents={shown}
                            masterCents={master}
                            own={isStore && isOwn("photo", key)}
                            title={`${labelOf(p, lang)} · ${t(`adm.price.lenses.cat.${cat}`)}`}
                            onSave={(v) => save({ kind: "photo", key, value: v })}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!lenses.photo.length && (
                  <tr><td className="pp-empty" colSpan={CATS.length + 1}>{t("adm.price.treat.empty")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="pp-pane">
          <h3>
            <span className="pp-pane-t">{t("adm.price.lenses.ar")}</span>
            <HelpTip topic="price.ar" />
          </h3>
          {/* Agrupado por a qué diseños se le puede poner: el dueño no cobra lo
              mismo en visión sencilla que en bifocal/progresivo, y así no hay
              que leer la etiqueta de grupo en cada línea. */}
          {AR_GROUPS.map((g) => {
            const list = lenses.ar.filter((a) => arGroupOf(a) === g);
            if (!list.length) return null;
            return (
              <div className="pp-sub" key={g}>
                <h4>{t(`adm.price.lenses.arGroup.${g}`)}</h4>
                <ul className="pp-list">
                  {list.map((a) => (
                    <li key={a.code}>
                      <span className="pp-name">{labelOf(a, lang)}</span>
                      {isStore && a.store_cents !== a.cents && (
                        <span className="pp-badge">{t("adm.price.lenses.masterIs", { v: money(a.cents / 100, "usd", lang) })}</span>
                      )}
                      <Cell
                        cents={isStore ? (a.store_cents ?? a.cents) : a.cents}
                        masterCents={a.cents}
                        own={isStore && isOwn("ar", a.code)}
                        title={labelOf(a, lang)}
                        onSave={(v) => save({ kind: "ar", key: a.code, value: v })}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!lenses.ar.length && <p className="pp-empty">{t("adm.price.treat.empty")}</p>}
        </section>
      </div>
    </>
  );
}
