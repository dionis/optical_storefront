// Self-healing deploys: a tab that is running an old bundle picks up the new one
// on its own, at a moment where reloading costs nothing.
//
// index.html is served no-store (see vercel.json), so a fresh navigation always
// gets the current bundle. The gap is the tab that never navigates: an SPA route
// change swaps components without fetching HTML, so someone who left the store
// open before a deploy keeps running the old JS — against a backend that has
// moved on — until they happen to hard-reload. That is the "it stays cached even
// though we shipped a fix" report, and no amount of cache headers fixes it.
//
// So: compare the bundle's build id against the deployed one and, when they
// differ, reload at the next safe point. No banner, no "a new version is
// available" prompt — the shopper is not the right person to decide when to
// reload a JavaScript bundle.

// Injected by vite.config.js at build time; "dev" in the dev server, where the
// check is a no-op (there is no /build-id.json to compare against).
const CURRENT = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

// A reload must never interrupt a purchase in progress. Checkout is excluded
// outright, and so is the pending-order recovery screen — reloading mid-payment
// is exactly the failure the retry logic in medusaCart.js exists to prevent.
const UNSAFE_PATHS = [/^\/checkout/, /^\/admin/];

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
let lastCheck = 0;
let reloading = false;

function pendingOrderExists() {
  try { return Boolean(localStorage.getItem("oer_pending_order")); } catch { return false; }
}

/** Is it safe to throw away this tab's JS right now? */
function safeToReload(pathname) {
  if (reloading || CURRENT === "dev") return false;
  if (pendingOrderExists()) return false;
  return !UNSAFE_PATHS.some((re) => re.test(pathname));
}

/**
 * Compare against the deployed build id and reload if this tab is behind.
 *
 * Call on route changes. Throttled, and silent about every failure: if
 * /build-id.json is missing or unreachable we simply keep running — a version
 * check is not worth breaking a working page over.
 */
export async function checkBuildVersion(pathname) {
  if (!safeToReload(pathname)) return;
  const now = Date.now();
  if (now - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = now;

  try {
    const res = await fetch("/build-id.json", { cache: "no-store" });
    if (!res.ok) return;
    const { build_id } = await res.json();
    if (!build_id || build_id === CURRENT) return;
    // Re-check: the fetch was async and the shopper may have walked into
    // checkout while it was in flight.
    if (!safeToReload(window.location.pathname)) return;
    reloading = true;
    window.location.reload();
  } catch {
    /* offline, or no build-id.json deployed — keep running */
  }
}
