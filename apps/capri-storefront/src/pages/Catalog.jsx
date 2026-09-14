import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useCatalog } from "../data/catalogStore.js";
import { BRAND_BY_SLUG } from "../data/brands.js";
import { FILTER_GROUPS, productMatches } from "../data/filters.js";
import { brandHeroImage, brandInfo } from "../data/brandMedia.js";
import ProductCard from "../components/ProductCard.jsx";
import CaseCard from "../components/CaseCard.jsx";
import { IconFilter, IconSort, IconGrid, IconList, IconCheck } from "../components/UiIcons.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { fetchReviewSummaries } from "../data/reviews.js";

export default function Catalog() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t, tv, lang } = useLang();
  const { products: PRODUCTS, cases: CASES } = useCatalog();
  const brand = slug ? BRAND_BY_SLUG[slug] : null;
  const q = (params.get("q") || "").toLowerCase().trim();
  const ageParam = params.get("age");
  const shapeParam = params.get("shape");
  const genderParam = params.get("gender");
  const ofertaParam = params.get("oferta");

  const [selected, setSelected] = useState({});
  const [sort, setSort] = useState("relevance");
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState("grid"); // 'grid' | 'list'
  const [sortOpen, setSortOpen] = useState(false);
  // All filter groups start CLOSED on load.
  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(FILTER_GROUPS.map((g) => [g.key, false]))
  );

  useEffect(() => {
    const sel = {};
    const opens = {};
    if (ageParam) { sel.age = [ageParam]; opens.age = true; }
    if (shapeParam) { sel.shape = [shapeParam]; opens.shape = true; }
    if (genderParam) { sel.gender = [genderParam]; opens.gender = true; }
    setSelected(sel);
    if (Object.keys(opens).length) setOpenGroups((prev) => ({ ...prev, ...opens }));
  }, [slug, ageParam, shapeParam, genderParam]);

  // Applying a filter, sort or search jumps back to the top of the listing.
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }); }, [selected, sort, q, slug]);

  // Ratings for "sort by rating". Only fetched when that sort is chosen: the
  // cards fetch their own summaries lazily as they render, but ORDERING the
  // list needs every frame's rating up front, not just the visible ones.
  const [ratings, setRatings] = useState({});
  useEffect(() => {
    if (sort !== "rating") return;
    let cancelled = false;
    fetchReviewSummaries(PRODUCTS.map((p) => p.slug))
      .then((found) => { if (!cancelled) setRatings(found); })
      .catch(() => { /* leave the list in its current order */ });
    return () => { cancelled = true; };
  }, [sort, PRODUCTS]);

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
      if (ofertaParam && !(typeof p.originalPrice === "number" && p.originalPrice > p.price)) return false;
      return true;
    });
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    if (sort === "brand") list = [...list].sort((a, b) =>
      (a.brand || "").localeCompare(b.brand || "", undefined, { sensitivity: "base", numeric: true }) ||
      (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }));
    // Sorting by rating means sorting by what customers actually gave. Frames
    // nobody has reviewed sort last rather than as a zero — they are unrated,
    // not badly rated. (This used to sort by the scraper's invented `rating`,
    // which put frames in a confident order nobody had voted on.)
    if (sort === "rating") {
      list = [...list].sort((a, b) => {
        const ra = ratings[a.slug]?.average ?? -1;
        const rb = ratings[b.slug]?.average ?? -1;
        return rb - ra;
      });
    }
    return list;
  }, [PRODUCTS, brand, q, selected, sort, ratings, ofertaParam]);

  const activeCount = Object.values(selected).reduce((s, a) => s + (a?.length || 0), 0);
  const urlFilterLabel = shapeParam ? tv(shapeParam) : genderParam ? tv(genderParam) : ageParam ? tv(ageParam) : null;
  const heading = brand ? brand.name
    : ofertaParam ? t("bn.offers")
    : q ? `${t("cat.results")}: “${q}”`
    : urlFilterLabel ? urlFilterLabel
    : t("cat.all");

  // Cases brand → dedicated cases listing (no frame filters)
  if (brand?.slug === "case") {
    return (
      <div className="section">
        <div className="listing-head">
          <div>
            <h1>{t("case.title")}</h1>
            <span className="count">{CASES.length} · {t("case.sub")}</span>
          </div>
        </div>
        <div className="case-grid">
          {CASES.map((c) => <CaseCard key={c.slug} item={c} />)}
        </div>
      </div>
    );
  }

  return (
    <>
      {brand && (
        <section className="brand-hero">
          <div className="brand-hero-media" aria-hidden="true">
            <img src={brandHeroImage(brand.slug)} alt=""
                 onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <div className="brand-hero-scrim" />
          </div>
          <div className="brand-hero-inner">
            <div className="brand-hero-logo">
              <img src={brand.logo} alt={brand.name}
                   onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
            </div>
            <h1>{brand.name}</h1>
            <p className="brand-hero-desc">{brandInfo(brand.slug, lang, brand.name).desc}</p>
            <span className="brand-hero-count">{results.length} {t("brand.frames")}</span>
          </div>
        </section>
      )}
    <div className="catalog">
      <aside className={`filters ${showFilters ? "show" : ""}`}>
        <div className="filters-head">
          <span>{t("filters.title")}</span>
          <div className="fh-actions">
            {activeCount > 0 && <button className="clear" onClick={() => setSelected({})}>{t("filters.clear")} ({activeCount})</button>}
            <button type="button" className="filters-close" onClick={() => setShowFilters(false)} aria-label="✕">✕</button>
          </div>
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
        <button type="button" className="filters-apply"
                onClick={() => { setShowFilters(false); setTimeout(() => document.getElementById("resultados")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }}>
          <IconCheck className="fa-ic" /> {t("filters.apply")} · {results.length}
        </button>
      </aside>

      <section className="listing">
        {!brand && (
          <div className="cat-hero">
            <div className="cat-hero-txt">
              <h1>{heading}</h1>
              <p>{t("cat.heroSub")}</p>
            </div>
            <img className="cat-hero-glass" src="/hero-glass34-blue.png" alt="" aria-hidden="true" loading="lazy" />
            <div className="cat-hero-script" aria-hidden="true">
              {t("cat.heroScript").split(",").map((s, i) => (
                <span key={i}>{s.trim()}</span>
              ))}
            </div>
          </div>
        )}

        <div className="filterbar" id="resultados">
          <button className={`fb-pill fb-filters ${activeCount > 0 ? "act" : ""}`}
                  onClick={() => setShowFilters((v) => !v)}>
            <IconFilter className="fb-ic" />
            <span>{t("filters.title")}{activeCount > 0 ? ` (${activeCount})` : ""}</span>
          </button>
          <div className="fb-sort">
            <button type="button" className="fb-pill fb-sortbtn" onClick={() => setSortOpen((o) => !o)}
                    aria-haspopup="listbox" aria-expanded={sortOpen}>
              <IconSort className="fb-ic" />
              <span>{t("sort.title")}</span>
              <span className="fb-caret" aria-hidden="true" />
            </button>
            {sortOpen && (
              <>
                <div className="fb-backdrop" onClick={() => setSortOpen(false)} />
                <ul className="fb-menu" role="listbox">
                  {[["relevance", "sort.relevance"], ["brand", "sort.brand"], ["price-asc", "sort.priceAsc"], ["price-desc", "sort.priceDesc"], ["rating", "sort.rating"]].map(([v, k]) => (
                    <li key={v}>
                      <button type="button" className={sort === v ? "on" : ""}
                              onClick={() => { setSort(v); setSortOpen(false); }}>{t(k)}</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <span className="fb-count">{results.length} {t("cat.count")}</span>
          <div className="fb-view" role="group" aria-label={t("sort.title")}>
            <button type="button" className={`fb-vbtn ${view === "grid" ? "on" : ""}`}
                    onClick={() => setView("grid")} aria-label={t("view.grid")} title={t("view.grid")}>
              <IconGrid className="fb-ic" />
            </button>
            <button type="button" className={`fb-vbtn ${view === "list" ? "on" : ""}`}
                    onClick={() => setView("list")} aria-label={t("view.list")} title={t("view.list")}>
              <IconList className="fb-ic" />
            </button>
          </div>
        </div>

        {results.length === 0 ? (
          <div className="empty">{t("empty.text")} <button onClick={() => setSelected({})}>{t("empty.clear")}</button></div>
        ) : (
          <div className={`product-grid ${view === "list" ? "list" : ""}`}>
            {results.map((p) => <ProductCard key={p.slug} product={p} />)}
          </div>
        )}
      </section>
    </div>
    </>
  );
}
