import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PRODUCTS } from "../data/products.js";
import { BRAND_BY_SLUG } from "../data/brands.js";
import { FILTER_GROUPS, productMatches } from "../data/filters.js";
import ProductCard from "../components/ProductCard.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

export default function Catalog() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t, tv, lang } = useLang();
  const brand = slug ? BRAND_BY_SLUG[slug] : null;
  const q = (params.get("q") || "").toLowerCase().trim();
  const ageParam = params.get("age");

  const [selected, setSelected] = useState({});
  const [sort, setSort] = useState("relevance");
  const [showFilters, setShowFilters] = useState(false);
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(FILTER_GROUPS.map((g, i) => [g.key, i < 4]))
  );

  useEffect(() => { setSelected(ageParam ? { age: [ageParam] } : {}); }, [slug, ageParam]);

  const toggle = (key, opt) => {
    setSelected((prev) => {
      const cur = prev[key] || [];
      const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
      return { ...prev, [key]: next };
    });
  };

  const results = useMemo(() => {
    let list = PRODUCTS.filter((p) => {
      if (brand && p.brand_slug !== brand.slug) return false;
      if (q && !(`${p.name} ${p.brand}`.toLowerCase().includes(q))) return false;
      if (!productMatches(p, selected)) return false;
      return true;
    });
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    if (sort === "rating") list = [...list].sort((a, b) => b.rating - a.rating);
    return list;
  }, [brand, q, selected, sort]);

  const activeCount = Object.values(selected).reduce((s, a) => s + (a?.length || 0), 0);
  const heading = brand ? brand.name : q ? `${t("cat.results")}: “${q}”` : t("cat.all");

  return (
    <div className="catalog">
      <button className="filters-toggle mobile-only" onClick={() => setShowFilters((v) => !v)}>
        {t("filters.title")}{activeCount > 0 ? ` (${activeCount})` : ""} {showFilters ? "▲" : "▼"}
      </button>

      <aside className={`filters ${showFilters ? "show" : ""}`}>
        <div className="filters-head">
          <span>{t("filters.title")}</span>
          {activeCount > 0 && <button className="clear" onClick={() => setSelected({})}>{t("filters.clear")} ({activeCount})</button>}
        </div>
        {FILTER_GROUPS.map((g) => (
          <div className="fgroup" key={g.key}>
            <button className="fgroup-head" onClick={() => setOpenGroups((o) => ({ ...o, [g.key]: !o[g.key] }))}>
              {g.title[lang]}<span>{openGroups[g.key] ? "−" : "+"}</span>
            </button>
            {openGroups[g.key] && (
              <div className="fgroup-body">
                {g.options.map((opt) => {
                  const on = (selected[g.key] || []).includes(opt);
                  return (
                    <label key={opt} className={`fopt ${g.field ? "" : "disabled"}`}>
                      <input type="checkbox" checked={on} disabled={!g.field} onChange={() => toggle(g.key, opt)} />
                      <span>{tv(opt)}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </aside>

      <section className="listing">
        <div className="listing-head">
          <div>
            <h1>{heading}</h1>
            <span className="count">{results.length} {t("cat.count")}</span>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="sort">
            <option value="relevance">{t("sort.relevance")}</option>
            <option value="price-asc">{t("sort.priceAsc")}</option>
            <option value="price-desc">{t("sort.priceDesc")}</option>
            <option value="rating">{t("sort.rating")}</option>
          </select>
        </div>

        {results.length === 0 ? (
          <div className="empty">{t("empty.text")} <button onClick={() => setSelected({})}>{t("empty.clear")}</button></div>
        ) : (
          <div className="product-grid">
            {results.map((p) => <ProductCard key={p.slug} product={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
