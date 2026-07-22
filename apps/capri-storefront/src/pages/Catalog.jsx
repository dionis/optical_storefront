import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { PRODUCTS } from "../data/products.js";
import { BRAND_BY_SLUG } from "../data/brands.js";
import { FILTER_GROUPS, productMatches } from "../data/filters.js";
import ProductCard from "../components/ProductCard.jsx";

export default function Catalog() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const brand = slug ? BRAND_BY_SLUG[slug] : null;
  const q = (params.get("q") || "").toLowerCase().trim();
  const ageParam = params.get("age");

  const [selected, setSelected] = useState({});
  const [sort, setSort] = useState("relevance");
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(FILTER_GROUPS.map((g, i) => [g.key, i < 4]))
  );

  // reset when navigating between brands
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

  return (
    <div className="catalog">
      <aside className="filters">
        <div className="filters-head">
          <span>Filtros</span>
          {activeCount > 0 && (
            <button className="clear" onClick={() => setSelected({})}>Limpiar ({activeCount})</button>
          )}
        </div>
        {FILTER_GROUPS.map((g) => (
          <div className="fgroup" key={g.key}>
            <button className="fgroup-head" onClick={() => setOpenGroups((o) => ({ ...o, [g.key]: !o[g.key] }))}>
              {g.title}<span>{openGroups[g.key] ? "−" : "+"}</span>
            </button>
            {openGroups[g.key] && (
              <div className="fgroup-body">
                {g.options.map((opt) => {
                  const on = (selected[g.key] || []).includes(opt);
                  return (
                    <label key={opt} className={`fopt ${g.field ? "" : "disabled"}`}>
                      <input type="checkbox" checked={on} disabled={!g.field} onChange={() => toggle(g.key, opt)} />
                      <span>{opt}</span>
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
            <h1>{brand ? brand.name : q ? `Resultados: “${q}”` : "Todos los espejuelos"}</h1>
            <span className="count">{results.length} monturas</span>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="sort">
            <option value="relevance">Relevancia</option>
            <option value="price-asc">Precio: menor a mayor</option>
            <option value="price-desc">Precio: mayor a menor</option>
            <option value="rating">Mejor valorados</option>
          </select>
        </div>

        {results.length === 0 ? (
          <div className="empty">No hay monturas con estos filtros. <button onClick={() => setSelected({})}>Limpiar filtros</button></div>
        ) : (
          <div className="product-grid">
            {results.map((p) => <ProductCard key={p.slug} product={p} />)}
          </div>
        )}
      </section>
    </div>
  );
}
