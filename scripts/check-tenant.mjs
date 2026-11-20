/**
 * Brand lint: no optician's name or supplier is hardcoded in the apps.
 *
 * Every store built from this repo shares the code; what names the store comes
 * from its manifest (tenants/<slug>/tenant.json) and the TENANT_* / STORE_*
 * variables. A literal "RUBI LENS" in a component ships RUBI LENS to every
 * other optician — exactly how the order SMS ended up signed "Óptica El Rancho"
 * for every store from August to November 2026. So this runs with `pnpm test`.
 *
 * Comments are ignored (they may name a store as an example). The few literals
 * that are legitimate — defaults of the identity modules, the supplier's URLs
 * until the supplier adapter exists, storage keys that must not change — are
 * listed in ALLOWED with the reason.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRANDS = /RUBI ?LENS|rubilens|caprioptics|El Rancho/i;

const SCAN = [
  "apps/capri-storefront/src",
  "apps/capri-storefront/index.html",
  "apps/backend/src",
  "apps/vto-web/src",
  "apps/vto-web/index.html",
  "apps/vto-web/report.html",
  "apps/vision-measure/services",
];
/** Catalogue data generated from the supplier: names it by construction. */
const SKIP_FILES = /(products|cases|frames-extra|frameMediaSample|lookbook)\.js$|__pycache__|\.json$/;

/** [file (repo-relative), what the allowed line contains, why]. */
const ALLOWED = [
  ["apps/capri-storefront/src/config/tenant.js", "pick(\"VITE_TENANT_", "fallbacks of the storefront identity module"],
  ["apps/backend/src/lib/tenant.ts", "str(\"STORE_NAME\", \"RUBI LENS\")", "default of the backend identity module"],
  ["apps/vto-web/src/i18n.ts", "VITE_TENANT_COMPACT_NAME || 'RUBILENS'", "fallback of the try-on brand"],
  ["apps/vto-web/src/i18n.ts", "'ai.practicePlaceholder'", "example placeholder of a free-text field"],
  ["apps/vto-web/src/i18n.ts", "'ai.capriNoBrowsing'", "supplier site named in a diagnosis (phase 4: supplier adapter)"],
  ["apps/vto-web/src", "'rubilens.", "localStorage keys: per-origin already; renaming them would erase saved preferences"],
  ["apps/vto-web/src/vision_measure_panel.ts", "'rubilens-report'", "window name, never shown"],
  ["apps/capri-storefront/src/admin/priceStore.js", "RUBI LENS", "pickup defaults move to the backend in phase 4"],
  ["apps/capri-storefront/src/admin/Costs.jsx", "caprioptics.com/product/", "supplier product link (phase 4: supplier adapter)"],
  ["apps/capri-storefront/src/data/brandMedia.js", "caprioptics.com/wp-content", "supplier photos (phase 4: supplier adapter)"],
  ["apps/capri-storefront/src/pages/Home.jsx", "caprioptics.com/wp-content", "supplier photos (phase 4: supplier adapter)"],
  ["apps/capri-storefront/src/admin/StoreStatement.jsx", "/logo-rubilens.png", "file name of a logo asset, to recognise the generic logo"],
  ["apps/vision-measure/services/api/vision_api.py", "caprioptics.com", "supplier photo host (phase 4: SUPPLIER_IMAGE_HOSTS)"],
  ["apps/vision-measure/services/api/vision_api.py", "or \"RUBILENS\"", "default of STORE_NAME"],
  ["apps/vision-measure/services/vision_measure/config.py", "or 'RUBILENS'", "default of STORE_NAME"],
  ["apps/vision-measure/services/vision_measure/capri_prompt.py", "caprioptics.com", "supplier prompt (phase 4: supplier adapter)"],
];

function files(path) {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full).flatMap((name) => files(join(path, name)));
}

/** Source with comments blanked out (line count preserved). */
function stripComments(src, ext) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  if (ext === ".py") {
    return src.replace(/"""[\s\S]*?"""/g, blank).replace(/(^|\s)#[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
  }
  let out = src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank);
  // `//` comments, but not the `//` of a URL.
  out = out.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
  return out;
}

const problems = [];
for (const path of SCAN) {
  for (const file of files(path)) {
    const ext = extname(file);
    if (![".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".py"].includes(ext) || SKIP_FILES.test(file)) continue;
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const lines = stripComments(readFileSync(file, "utf8"), ext).split("\n");
    lines.forEach((line, i) => {
      if (!BRANDS.test(line)) return;
      const ok = ALLOWED.some(([where, contains]) => (rel === where || rel.startsWith(where + "/")) && line.includes(contains));
      if (!ok) problems.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
}

if (problems.length) {
  console.error(`check:tenant — a store or supplier name is hardcoded (${problems.length}):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nTake it from the tenant instead: TENANT.* (src/config/tenant.js), tenant()/tenantName() (backend)," +
      " {brand}/{site} in the dictionary, or VITE_TENANT_COMPACT_NAME in the try-on. A legitimate exception goes" +
      " in ALLOWED in scripts/check-tenant.mjs, with the reason."
  );
  process.exit(1);
}
console.log("tenant ok — no hardcoded store or supplier names in the apps");
