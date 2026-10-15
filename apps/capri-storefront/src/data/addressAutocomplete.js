// Address autocomplete — Google Places when configured, manual fallback otherwise.
//
// Requirement 15: fill separate address fields (street, postal code, city,
// country) Google-Maps style while the user types. When
// `import.meta.env.VITE_GOOGLE_MAPS_KEY` is present we lazy-load the Google
// Places JS library and attach an Autocomplete widget that parses the picked
// place into its parts. When the key is absent (or the script fails to load)
// the storefront simply keeps its plain separate inputs — the build never
// depends on Google being reachable, so this can never break the bundle.

const GOOGLE_KEY =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_GOOGLE_MAPS_KEY) ||
  "";

/** True when a Google Maps key is configured. Used to decide UI hints only. */
export function hasGooglePlaces() {
  return !!GOOGLE_KEY;
}

/** El checkout SIEMPRE tiene autocompletado: Google si hay llave, y si no el
 * respaldo abierto (Photon/OpenStreetMap) de más abajo. */
export function hasAddressAutocomplete() {
  return true;
}

let scriptPromise = null;

// Load the Google Maps JS API (Places library) exactly once. Resolves with the
// global `google` object, or rejects if there is no key / the script errors.
function loadGoogleMaps() {
  if (!GOOGLE_KEY) return Promise.reject(new Error("no-google-key"));
  if (typeof window === "undefined") return Promise.reject(new Error("no-window"));
  if (window.google && window.google.maps && window.google.maps.places) {
    return Promise.resolve(window.google);
  }
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    // Reuse an in-flight tag if one already exists (e.g. React StrictMode
    // double-invoke in dev) instead of injecting the loader twice.
    const existing = document.getElementById("gmaps-places-sdk");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google));
      existing.addEventListener("error", reject);
      if (window.google && window.google.maps) resolve(window.google);
      return;
    }
    const s = document.createElement("script");
    s.id = "gmaps-places-sdk";
    s.async = true;
    s.defer = true;
    s.src =
      "https://maps.googleapis.com/maps/api/js?libraries=places&key=" +
      encodeURIComponent(GOOGLE_KEY);
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("gmaps-load-failed"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

// Turn a Google Place's address_components into the flat, separate fields the
// checkout form binds to. Missing parts come back as empty strings so callers
// can safely spread the result without clobbering unrelated state.
function parsePlace(place) {
  const out = {
    address_1: "",
    postal_code: "",
    city: "",
    state: "",
    country: "",
    country_code: "",
  };
  const comps = (place && place.address_components) || [];
  let streetNumber = "";
  let route = "";
  for (const c of comps) {
    const types = c.types || [];
    if (types.includes("street_number")) streetNumber = c.long_name;
    else if (types.includes("route")) route = c.long_name;
    else if (types.includes("postal_code")) out.postal_code = c.long_name;
    else if (types.includes("locality") || types.includes("postal_town")) out.city = c.long_name;
    else if (!out.city && types.includes("sublocality")) out.city = c.long_name;
    else if (!out.city && types.includes("administrative_area_level_2")) out.city = c.long_name;
    else if (types.includes("administrative_area_level_1")) out.state = c.short_name || c.long_name;
    else if (types.includes("country")) {
      out.country = c.long_name;
      out.country_code = (c.short_name || "").toLowerCase();
    }
  }
  out.address_1 = [streetNumber, route].filter(Boolean).join(" ").trim();
  // Fall back to the formatted street line if components were sparse.
  if (!out.address_1 && place && place.name) out.address_1 = place.name;
  return out;
}

/**
 * Attach Google Places autocomplete to a street input.
 *
 * @param {HTMLInputElement} inputEl  the "street / address line 1" input
 * @param {(parts) => void}  onSelect  called with parsed { address_1,
 *   postal_code, city, country, country_code } when the user picks a place
 * @returns {() => void} cleanup function; always safe to call
 *
 * When Google is unavailable this resolves to a no-op cleanup and the caller's
 * separate manual inputs keep working unchanged.
 */
export function attachAddressAutocomplete(inputEl, onSelect) {
  let cleanup = () => {};
  if (!inputEl) return cleanup;
  // Sin llave de Google: respaldo profesional con Photon (OpenStreetMap) —
  // mismas partes (calle, ciudad, CP) al elegir una sugerencia, solo EE. UU.
  if (!GOOGLE_KEY) return attachPhoton(inputEl, onSelect);

  let cancelled = false;
  let listener = null;
  let autocomplete = null;

  loadGoogleMaps()
    .then((google) => {
      if (cancelled || !inputEl) return;
      autocomplete = new google.maps.places.Autocomplete(inputEl, {
        types: ["address"],
        fields: ["address_components", "name", "formatted_address"],
      });
      listener = autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (place && place.address_components) {
          onSelect(parsePlace(place));
        }
      });
    })
    .catch(() => {
      // Silent: no key, offline, or blocked — manual fields remain the UX.
    });

  cleanup = () => {
    cancelled = true;
    try {
      if (listener && window.google && window.google.maps) {
        window.google.maps.event.removeListener(listener);
      }
    } catch { /* ignore */ }
    // Remove the widget's autocomplete dropdown containers Google appends to body.
    try {
      document.querySelectorAll(".pac-container").forEach((n) => n.remove());
    } catch { /* ignore */ }
  };
  return cleanup;
}


// ── Respaldo sin llave: Photon (OpenStreetMap) ──────────────────────────────
// Autocompletado de direcciones de EE. UU. con número y calle. Sugerencias en
// un desplegable propio bajo el campo; al elegir, se rellenan calle, ciudad y
// código postal de una vez. Si la red falla, el campo manual sigue funcionando.
function attachPhoton(inputEl, onSelect) {
  const host = inputEl.parentElement;
  const prevPos = host.style.position;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const box = document.createElement("div");
  box.className = "addr-sugg";
  box.style.display = "none";
  host.appendChild(box);
  inputEl.setAttribute("autocomplete", "off");

  let timer = null;
  let ctrl = null;
  const close = () => { box.style.display = "none"; box.innerHTML = ""; };
  const onInput = () => {
    const q = inputEl.value.trim();
    clearTimeout(timer);
    if (q.length < 4) { close(); return; }
    timer = setTimeout(async () => {
      try {
        if (ctrl) ctrl.abort();
        ctrl = new AbortController();
        const r = await fetch(
          "https://photon.komoot.io/api/?limit=6&lang=en&q=" + encodeURIComponent(q),
          { signal: ctrl.signal }
        );
        const j = await r.json();
        const feats = (j.features || []).filter((ft) => {
          const pr = ft.properties || {};
          return pr.countrycode === "US" && pr.street;
        }).slice(0, 5);
        if (!feats.length) { close(); return; }
        box.innerHTML = "";
        feats.forEach((ft) => {
          const pr = ft.properties;
          const street = [pr.housenumber, pr.street].filter(Boolean).join(" ");
          const cityName = pr.city || pr.town || pr.village || pr.district || "";
          const it = document.createElement("button");
          it.type = "button";
          it.className = "addr-sugg-it";
          it.textContent = [street, cityName, pr.state, pr.postcode].filter(Boolean).join(", ");
          // pointerdown (no click): gana al blur del input y la elección entra.
          it.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            onSelect({
              address_1: street,
              city: cityName,
              state: pr.state || "",
              postal_code: pr.postcode || "",
              country: "United States",
              country_code: "us",
            });
            close();
          });
          box.appendChild(it);
        });
        box.style.display = "block";
      } catch { /* red caída o bloqueada: el campo manual sigue */ }
    }, 320);
  };
  const onBlur = () => setTimeout(close, 160);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("blur", onBlur);
  inputEl.addEventListener("keydown", onKey);
  return () => {
    clearTimeout(timer);
    if (ctrl) ctrl.abort();
    inputEl.removeEventListener("input", onInput);
    inputEl.removeEventListener("blur", onBlur);
    inputEl.removeEventListener("keydown", onKey);
    box.remove();
    host.style.position = prevPos;
  };
}
