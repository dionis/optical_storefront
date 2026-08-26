import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";

// Replaces the procedural try-on (TryOn.jsx, kept on disk but no longer wired in) with
// the ported eyewear-vto-web app (apps/vto-web), run in an iframe rather than merged
// into this React tree: it is a vanilla-TS/Three.js SPA with its own global DOM ids and
// CSS, so mounting it directly here would collide with this page's own elements.
//
// `?sku=` only matches a product if apps/vto-web ships a real .glb for it (see
// apps/vto-web/public/models/ and index.html's sku-list) — today that is just the one
// sample frame, everything else falls back to vto-web's own procedural placeholder.
// That gap closes as real per-SKU .glb files are produced and added there, not here.
// Production always serves it same-origin, built into public/tryon-3d/ (see root
// vercel.json) — hardcoded rather than left to an env var someone has to remember to
// set on the Vercel project. VITE_TRYON3D_URL only matters for dev/preview, where
// apps/vto-web runs as its own dev server.
const TRYON3D_BASE = import.meta.env.PROD
  ? "/tryon-3d"
  : import.meta.env.VITE_TRYON3D_URL || "http://localhost:3000";

export default function TryOn3D({ product, colorIdx = 0, onClose }) {
  const { t, lang } = useLang();
  const color = product.colors?.[colorIdx] || product.colors?.[0];

  const params = new URLSearchParams({ lang, sku: product.sku || "" });
  if (color?.name) params.set("color", color.name);
  // Pre-fills the AI panel's "Imagen del espejuelo" from this exact photo, so the
  // customer never has to find or upload a picture of the frame they are already
  // wearing on screen. Fetched server-side by vto-web (see fetchProxiedImage) — the
  // supplier's image host sends no CORS headers, so the browser can't read it directly.
  if (color?.image) params.set("glassesImageUrl", color.image);
  const src = `${TRYON3D_BASE.replace(/\/$/, "")}/index.html?${params.toString()}`;

  return createPortal(
    <div className="tryon" role="dialog" aria-modal="true">
      <div className="tryon-bar">
        <span className="tryon-title">👓 {t("tryon.title")} · {product.name}</span>
        <button className="tryon-x" onClick={onClose} aria-label={t("tryon.close")}>×</button>
      </div>
      <div className="tryon-stage">
        <iframe
          className="tryon-iframe"
          src={src}
          title={t("tryon.title")}
          allow="camera *; fullscreen *"
        />
      </div>
    </div>,
    document.body
  );
}
