import { useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { PRODUCT_BY_SLUG } from "../data/products.js";
import { useCart } from "../components/CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

const fmt = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(2);
function range(min, max, step) {
  const out = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
const SPH = range(-20, 12, 0.25).map((v) => ({ v, label: fmt(v) }));
const CYL = range(-6, 6, 0.25).map((v) => ({ v, label: fmt(v) }));
const AXIS = range(0, 180, 1).map((v) => ({ v, label: v === 0 ? "—" : v + "°" }));
const ADD = range(0.75, 3.5, 0.25).map((v) => ({ v, label: "+" + v.toFixed(2) }));
const PD = range(50, 76, 0.5).map((v) => ({ v, label: v.toFixed(1) }));

const USAGE = [
  { key: "sv-dist", label: "usage.svDist", desc: "usage.svDist.d", price: 6.95, rx: true },
  { key: "sv-read", label: "usage.svRead", desc: "usage.svRead.d", price: 6.95, rx: true },
  { key: "progressive", label: "usage.prog", desc: "usage.prog.d", price: 49.0, rx: true, add: true },
  { key: "frame-only", label: "usage.frame", desc: "usage.frame.d", price: 0, rx: false },
];
const INDEX = [
  { key: "1.50", label: "idx.std", desc: "idx.std.d", tip: "idx.std.tip", price: 0, max: 2 },
  { key: "1.59", label: "idx.poly", desc: "idx.poly.d", tip: "idx.poly.tip", price: 20, max: 3, poly: true },
  { key: "1.61", label: "idx.thin", desc: "idx.thin.d", tip: "idx.thin.tip", price: 35, max: 4 },
  { key: "1.67", label: "idx.ultra", desc: "idx.ultra.d", tip: "idx.ultra.tip", price: 60, max: 6 },
  { key: "1.74", label: "idx.hi", desc: "idx.hi.d", tip: "idx.hi.tip", price: 95, max: 99 },
];
const COATINGS = [
  { key: "ar", label: "coat.ar", tip: "coat.ar.tip", price: 8 },
  { key: "blue", label: "coat.blue", tip: "coat.blue.tip", price: 20 },
  { key: "photo", label: "coat.photo", tip: "coat.photo.tip", price: 45 },
  { key: "tint", label: "coat.tint", tip: "coat.tint.tip", price: 15 },
];

function HelpTip({ text, title }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help-wrap">
      <button type="button" className="help-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} aria-label="?">ⓘ</button>
      {open && (
        <span className="help-pop" onClick={(e) => e.stopPropagation()}>
          <b>{title}</b>
          <span>{text}</span>
          <button type="button" className="help-close" onClick={() => setOpen(false)}>×</button>
        </span>
      )}
    </span>
  );
}

function SelectCell({ value, onChange, options, t }) {
  return (
    <select className="rx-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}
function Field({ label, value, onChange, options, t, withEmpty }) {
  return (
    <label className="rx-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {withEmpty && <option value="">{t("lens.select")}</option>}
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </label>
  );
}

export default function LensProcess() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t } = useLang();
  const product = PRODUCT_BY_SLUG[slug];
  const colorIdx = Number(params.get("color") || 0);
  const navigate = useNavigate();
  const { addItem } = useCart();

  const STEPS = [t("lens.step.use"), t("lens.step.rx"), t("lens.step.lens"), t("lens.step.summary")];
  const [step, setStep] = useState(0);
  const [usage, setUsage] = useState(null);
  const [index, setIndex] = useState(null);
  const [coatings, setCoatings] = useState([]);
  const [rx, setRx] = useState({ od_sph: "0", od_cyl: "0", od_axis: "0", os_sph: "0", os_cyl: "0", os_axis: "0", pd: "", add: "" });
  const [uploaded, setUploaded] = useState(null);

  if (!product) return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;
  const color = product.colors[colorIdx] || product.colors[0];
  const frameOnly = usage?.key === "frame-only";

  const maxAbs = Math.max(
    Math.abs(parseFloat(rx.od_sph) || 0), Math.abs(parseFloat(rx.os_sph) || 0),
    Math.abs(parseFloat(rx.od_cyl) || 0), Math.abs(parseFloat(rx.os_cyl) || 0)
  );
  const recommended = useMemo(() => {
    if (product.attributes.age === "Niños") return INDEX.find((i) => i.poly);
    return INDEX.find((i) => maxAbs <= i.max) || INDEX[INDEX.length - 1];
  }, [maxAbs, product.attributes.age]);

  const total = useMemo(() => {
    let x = product.price;
    if (usage) x += usage.price;
    if (index && !frameOnly) x += index.price;
    if (!frameOnly) x += coatings.reduce((s, c) => s + c.price, 0);
    return Math.round(x * 100) / 100;
  }, [product.price, usage, index, coatings, frameOnly]);

  const toggleCoat = (c) =>
    setCoatings((prev) => (prev.find((x) => x.key === c.key) ? prev.filter((x) => x.key !== c.key) : [...prev, c]));

  const canNext = (step === 0 && usage) || step === 1 || (step === 2 && (frameOnly || index)) || step === 3;
  const finish = () => {
    addItem({ sku: product.sku, name: product.name, color: color.name, usage: usage?.key, index: index?.key, total });
    alert(t("lens.added"));
    navigate(`/producto/${product.slug}`);
  };
  const setF = (k) => (v) => setRx((r) => ({ ...r, [k]: v }));

  return (
    <div className="lens">
      <div className="lens-head">
        <Link to={`/producto/${product.slug}`} className="back">← {t("lens.back")} {product.name}</Link>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`stepdot ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} onClick={() => i < step && setStep(i)}>
              <span>{i < step ? "✓" : i + 1}</span>{s}
            </div>
          ))}
        </div>
      </div>

      <div className="lens-grid">
        <div className="lens-body">
          {step === 0 && (
            <div>
              <h2>{t("lens.q.use")}</h2>
              <div className="opt-grid">
                {USAGE.map((u) => (
                  <button key={u.key} className={`opt-card ${usage?.key === u.key ? "sel" : ""}`} onClick={() => setUsage(u)}>
                    <b>{t(u.label)}</b><small>{t(u.desc)}</small>
                    <span className="opt-price">{u.price ? `+ $${u.price.toFixed(2)}` : t("lens.included")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2>{t("lens.q.rx")}</h2>
              {frameOnly ? (
                <p className="muted">{t("lens.rx.none")}</p>
              ) : (
                <>
                  <div className="rx-upload">
                    <label className="upload-box">
                      <input type="file" accept="image/*,application/pdf" hidden
                             onChange={(e) => setUploaded(e.target.files?.[0]?.name || null)} />
                      <span>📤 {t("lens.upload")}</span>
                      <small>{uploaded ? `${t("lens.upload.file")}: ${uploaded}` : t("lens.upload.sub")}</small>
                    </label>
                    <span className="or">{t("lens.or")}</span>
                  </div>
                  <p className="muted small">{t("lens.rxHelp")}</p>
                  <table className="rx-table">
                    <thead><tr><th></th><th>ESF / SPH</th><th>CIL / CYL</th><th>EJE / AXIS</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>{t("lens.right")}</td>
                        <td><SelectCell value={rx.od_sph} onChange={setF("od_sph")} options={SPH} t={t} /></td>
                        <td><SelectCell value={rx.od_cyl} onChange={setF("od_cyl")} options={CYL} t={t} /></td>
                        <td><SelectCell value={rx.od_axis} onChange={setF("od_axis")} options={AXIS} t={t} /></td>
                      </tr>
                      <tr>
                        <td>{t("lens.left")}</td>
                        <td><SelectCell value={rx.os_sph} onChange={setF("os_sph")} options={SPH} t={t} /></td>
                        <td><SelectCell value={rx.os_cyl} onChange={setF("os_cyl")} options={CYL} t={t} /></td>
                        <td><SelectCell value={rx.os_axis} onChange={setF("os_axis")} options={AXIS} t={t} /></td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="rx-extra">
                    <Field label={t("lens.pd")} value={rx.pd} onChange={setF("pd")} options={PD} t={t} withEmpty />
                    {usage?.add && <Field label={t("lens.addLbl")} value={rx.add} onChange={setF("add")} options={ADD} t={t} withEmpty />}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <h2>{frameOnly ? t("lens.frameOnlyTitle") : t("lens.q.lens")}</h2>
              {frameOnly ? (
                <p className="muted">{t("lens.frameOnlyDesc")}</p>
              ) : (
                <>
                  {recommended && (
                    <div className="reco">
                      <b>💡 {t("lens.recommend")} {t(recommended.label)}</b>
                      <span>{t("lens.recommendHint")}</span>
                    </div>
                  )}
                  <div className="opt-list">
                    {INDEX.map((ix) => (
                      <label key={ix.key} className={`choice ${index?.key === ix.key ? "sel" : ""}`}>
                        <input type="radio" name="lensidx" checked={index?.key === ix.key} onChange={() => setIndex(ix)} />
                        <span className="choice-main">
                          <span className="choice-title">
                            {t(ix.label)}
                            {recommended?.key === ix.key && <span className="reco-badge">★</span>}
                            <HelpTip title={t("help.title")} text={t(ix.tip)} />
                          </span>
                          <small className="choice-desc">{t(ix.desc)}</small>
                        </span>
                        <span className="choice-price">{ix.price ? `+ $${ix.price}` : t("lens.included")}</span>
                      </label>
                    ))}
                  </div>
                  <h3 className="mt">{t("lens.treatments")}</h3>
                  <div className="opt-list">
                    {COATINGS.map((c) => {
                      const on = !!coatings.find((x) => x.key === c.key);
                      return (
                        <label key={c.key} className={`choice ${on ? "sel" : ""}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleCoat(c)} />
                          <span className="choice-main">
                            <span className="choice-title">{t(c.label)}<HelpTip title={t("help.title")} text={t(c.tip)} /></span>
                          </span>
                          <span className="choice-price">+${c.price}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h2>{t("lens.summary")}</h2>
              <ul className="summary">
                <li><span>{t("card.frame")} {product.name} · {color.name}</span><b>${product.price.toFixed(2)}</b></li>
                {usage && <li><span>{t("lens.use")}: {t(usage.label)}</span><b>{usage.price ? `$${usage.price.toFixed(2)}` : t("lens.included")}</b></li>}
                {index && !frameOnly && <li><span>{t("lens.lens")} {t(index.label)}</span><b>{index.price ? `$${index.price}` : t("lens.included")}</b></li>}
                {!frameOnly && coatings.map((c) => <li key={c.key}><span>{t(c.label)}</span><b>${c.price}</b></li>)}
                {!frameOnly && <li><span>{t("lens.q.rx")}: OD {fmt(parseFloat(rx.od_sph) || 0)} / OS {fmt(parseFloat(rx.os_sph) || 0)}</span><b>✓</b></li>}
              </ul>
              <p className="muted small">{t("lens.note")}</p>
            </div>
          )}
        </div>

        <aside className="lens-side">
          <img src={color.image} alt={product.name} onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
          <div className="lens-side-name">{product.name} · {color.name}</div>
          <div className="lens-side-total"><span>{t("lens.total")}</span><b>${total.toFixed(2)}</b></div>
          <div className="lens-nav">
            {step > 0 && <button className="btn btn-outline" onClick={() => setStep((s) => s - 1)}>{t("lens.back2")}</button>}
            {step < 3 ? (
              <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>{t("lens.continue")}</button>
            ) : (
              <button className="btn btn-primary" onClick={finish}>{t("lens.addCart")}</button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
