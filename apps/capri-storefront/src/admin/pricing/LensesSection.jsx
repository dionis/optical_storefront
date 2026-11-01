// Dónde se usa: «Precios y costos» → pestaña «Lentes».
//
// La matriz del dueño (diseño × material) editable en la propia celda, PARTIDA
// POR TIPO DE DISEÑO: «tienen que estar en visión sencilla, multifocal, etc.».
// Antes eran 13 filas seguidas y había que bajar para ver los monofocales; ahora
// se entra por el tipo (visión sencilla / bifocal / progresivo) y solo se pinta
// ese tipo. El tipo NO se adivina del nombre: viene del servidor en `category`
// (sv/bifocal/prog), que es lo mismo que usa el cálculo del precio.
//
// Dentro de los progresivos hay muchos modelos con nombre propio, así que
// además se pueden filtrar por su gama (`tier`, texto del dueño, no copy de la
// interfaz) — el filtro solo aparece cuando hay más de una gama que elegir.
//
// Los fotocromáticos y los antirreflejos se fueron a su propia pestaña
// (TreatmentsSection.jsx): son tratamientos, no diseños de lente.
import { useMemo, useState } from "react";
import { useLang } from "../../i18n/LanguageContext.jsx";
import HelpTip from "../HelpTip.jsx";
import Icon from "../icons.jsx";
import { AdjustRow, Cell, labelOf, useLensWriter } from "./lensShared.jsx";

/** Orden de las pestañas de tipo: como se vende, de lo simple a lo complejo. */
const CAT_ORDER = ["sv", "bifocal", "prog"];
const CAT_ICON = { sv: "eye", bifocal: "layers", prog: "sparkles" };

export default function LensesSection({ lenses, store, cat, onCat, onSaved, onError }) {
  const { t, lang } = useLang();
  const { save, isOwn, isStore } = useLensWriter({ lenses, store, onSaved, onError });
  const [tier, setTier] = useState(null);

  // Los diseños agrupados por su categoría del servidor. Una categoría sin
  // diseños no saca pestaña: el panel no inventa tipos que la lista no tiene.
  const byCat = useMemo(() => {
    const map = new Map();
    for (const d of lenses.designs) {
      const key = CAT_ORDER.includes(d.category) ? d.category : "sv";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(d);
    }
    return map;
  }, [lenses.designs]);

  const cats = CAT_ORDER.filter((c) => byCat.has(c));
  const active = cats.includes(cat) ? cat : cats[0] || null;
  const designs = active ? byCat.get(active) : [];

  // Gamas de ESTE tipo, en el orden en que las manda el servidor (`sort`).
  const tiers = useMemo(() => {
    const seen = [];
    for (const d of designs) {
      const v = d.tier || null;
      if (!seen.some((x) => x === v)) seen.push(v);
    }
    return seen;
  }, [designs]);
  const picked = tiers.some((x) => x === tier) ? tier : null;
  const rows = picked === null ? designs : designs.filter((d) => (d.tier || null) === picked);

  const baseCell = (design, material) =>
    lenses.base.find((b) => b.design_code === design && b.material_code === material) ?? null;

  return (
    <>
      <div className="pp-bar">
        {/* El título de la matriz vive aquí y no en un <caption>: la cabecera
            de la tabla es pegajosa y un caption dentro del marco se le mete
            debajo al bajar. Aquí además comparte línea con el selector. */}
        <h4 className="pp-bar-t">
          {t("adm.price.lenses.matrix")}
          <HelpTip topic="price.lensMatrix" />
          {active === "prog" && <HelpTip topic="price.progressive" />}
        </h4>
        <div className="pp-seg" role="tablist" aria-label={t("adm.price.lenses.catNav")}>
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === active}
              className={c === active ? "on" : ""}
              title={t("adm.price.lenses.catCount", { n: byCat.get(c).length })}
              onClick={() => { setTier(null); onCat(c); }}
            >
              <Icon name={CAT_ICON[c]} size={14} />
              {t(`adm.price.lenses.cat.${c}`)}
              <span className="pp-seg-n">{byCat.get(c).length}</span>
            </button>
          ))}
        </div>
        <AdjustRow lenses={lenses} store={store} onSaved={onSaved} onError={onError} />
      </div>

      {tiers.length > 1 && (
        <div className="pp-chips" role="group" aria-label={t("adm.price.lenses.tier")}>
          <button type="button" className={picked === null ? "on" : ""} onClick={() => setTier(null)}>
            {t("adm.price.lenses.tierAll")}
          </button>
          {tiers.map((x) => (
            <button key={x || "none"} type="button" className={picked === x ? "on" : ""} onClick={() => setTier(x)}>
              {x || t("adm.price.lenses.tierNone")}
            </button>
          ))}
        </div>
      )}

      <div className="pp-grid-wrap tall">
        <table className="pp-grid">
          <thead>
            <tr>
              <th>{t("adm.price.lenses.design")}</th>
              {lenses.materials.map((m) => <th key={m.code}>{labelOf(m, lang)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.code}>
                <th scope="row">
                  {labelOf(d, lang)}
                  {d.tier && <span className="pp-tier">{d.tier}</span>}
                  {(lang === "en" ? d.use_en : d.use_es) && <span className="pp-use">{lang === "en" ? d.use_en : d.use_es}</span>}
                </th>
                {lenses.materials.map((m) => {
                  const cell = baseCell(d.code, m.code);
                  const key = `${d.code}:${m.code}`;
                  const shown = isStore ? (cell?.store_cents ?? cell?.cents ?? 0) : (cell?.cents ?? 0);
                  return (
                    <td key={m.code}>
                      <Cell
                        cents={shown}
                        masterCents={cell?.cents ?? null}
                        own={isStore && isOwn("base", key)}
                        title={t("adm.price.lenses.editCell", { design: labelOf(d, lang), material: labelOf(m, lang) })}
                        onSave={(v) => save({ kind: "base", key, value: v })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="pp-empty" colSpan={lenses.materials.length + 1}>{t("adm.price.lenses.catEmpty")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
