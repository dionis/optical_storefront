import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useCatalog } from "../data/catalogStore.js";
import { GENERATED_INDEX, GENERATED_VIEWS } from "../data/frameMediaSample.js";
import { resolveImage } from "../data/imageUrl.js";

// Review surface for AI-generated frame media. DEV ONLY — mounted behind
// MEDIA_REVIEW_ENABLED, off by default.
//
// It exists because generating 608 images is the easy half; LOOKING at 608 images is
// the half that decides whether any of them reach a customer (see the acceptance
// criteria in docs/frame-media-generation.md §B.5). Doing that one product page at a
// time is not a review, it is a chore nobody finishes.
//
// The one thing that makes a judgement possible is showing the four generated angles
// NEXT TO the supplier photograph. These views are invented, not observed, and the
// only question that matters — "is this the same frame?" — cannot be answered by
// looking at a generated image on its own.

const SLOTS = ["front", "left", "right", "back"];

/** Frames whose generated media is most likely to be wrong, first. */
const RISK = ["rimless-3piece", "rimless", "transparent", "pale", "thin-metal"];

function riskScore(tags) {
  return (tags || []).reduce(
    (score, tag) => score + Math.max(0, RISK.length - RISK.indexOf(tag)) * (RISK.includes(tag) ? 1 : 0),
    0
  );
}

export default function MediaReview() {
  const { t } = useLang();
  const { productBySlug } = useCatalog();
  const [openHandle, setOpenHandle] = useState(null);
  const [onlyRisky, setOnlyRisky] = useState(false);

  const frames = useMemo(() => {
    const list = onlyRisky
      ? GENERATED_INDEX.filter((f) => (f.tags || []).some((tag) => RISK.includes(tag)))
      : [...GENERATED_INDEX];
    // Hardest first: that is where the model invents a different frame, and a review
    // that starts with the easy ones builds false confidence.
    return list.sort((a, b) => riskScore(b.tags) - riskScore(a.tags) || a.sku.localeCompare(b.sku));
  }, [onlyRisky]);

  const totals = useMemo(
    () => ({
      frames: GENERATED_INDEX.length,
      colorways: GENERATED_INDEX.reduce((n, f) => n + f.colorways.length, 0),
      views: GENERATED_INDEX.reduce((n, f) => n + f.viewCount, 0),
    }),
    []
  );

  return (
    <div className="section mrev">
      <h1>{t("mrev.title")}</h1>
      <p className="mrev-sub">
        {t("mrev.summary")
          .replace("{frames}", totals.frames)
          .replace("{colorways}", totals.colorways)
          .replace("{views}", totals.views)}
      </p>
      <p className="mrev-warn">{t("mrev.warning")}</p>

      <label className="mrev-filter">
        <input type="checkbox" checked={onlyRisky} onChange={(e) => setOnlyRisky(e.target.checked)} />
        {t("mrev.onlyRisky")}
      </label>

      <div className="mrev-list">
        {frames.map((frame) => {
          const open = openHandle === frame.handle;
          // The supplier photo comes from the catalogue, keyed by the storefront's
          // own seed slug — the generated media is keyed by the Medusa handle, and
          // the two do not agree (see §B.3).
          const product = productBySlug && productBySlug[frame.seedSlug];

          return (
            <div key={frame.handle} className={`mrev-frame ${open ? "open" : ""}`}>
              <button
                type="button"
                className="mrev-head"
                aria-expanded={open}
                onClick={() => setOpenHandle(open ? null : frame.handle)}
              >
                <span className="mrev-sku">{frame.sku}</span>
                <span className="mrev-brand">{frame.brand}</span>
                <span className="mrev-count">
                  {frame.colorways.length} · {frame.viewCount} {t("mrev.views")}
                </span>
                <span className="mrev-tags">
                  {(frame.tags || []).map((tag) => (
                    <em key={tag} className="mrev-tag">{tag}</em>
                  ))}
                  <em className="mrev-tag reason">{frame.reason}</em>
                </span>
              </button>

              {open && (
                <div className="mrev-body">
                  <Link className="mrev-link" to={`/producto/${frame.seedSlug}`}>
                    {t("mrev.openProduct")}
                  </Link>

                  {frame.colorways.map((colour) => {
                    const slots = (GENERATED_VIEWS[frame.handle] || {})[colour] || {};
                    const original = (product?.colors || []).find((c) => c.name === colour);

                    return (
                      <div key={colour} className="mrev-row">
                        <div className="mrev-colour">{colour}</div>
                        <div className="mrev-strip">
                          {/* The reference, always first. Everything to its right is
                              a guess that has to match it. */}
                          <figure className="mrev-shot ref">
                            <img
                              src={original?.image}
                              alt={`${frame.sku} ${colour}`}
                              loading="lazy"
                              onError={(e) => { e.currentTarget.style.opacity = 0.25; }}
                            />
                            <figcaption>{t("mrev.original")}</figcaption>
                          </figure>
                          {SLOTS.map((slot) =>
                            slots[slot] ? (
                              <figure key={slot} className="mrev-shot">
                                <img
                                  src={resolveImage(slots[slot])}
                                  alt={`${frame.sku} ${colour} ${slot}`}
                                  loading="lazy"
                                  onError={(e) => { e.currentTarget.style.opacity = 0.25; }}
                                />
                                <figcaption>{t(`pdp.media.view.${slot}`)}</figcaption>
                              </figure>
                            ) : null
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
