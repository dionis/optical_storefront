// Autocompletado de dirección de entrega — Google Places cuando hay llave,
// respaldo abierto (Photon / OpenStreetMap) cuando no la hay.
//
// Requisito 15: mientras el cliente teclea la calle se le ofrecen direcciones
// reales y, al elegir una, se rellenan de una vez calle, ciudad, estado, código
// postal y país. Así no hay errores de tecleo en la dirección de envío.
//
// Google: se usa la API nueva de Places (`AutocompleteSuggestion` +
// `Place.fetchFields`). El widget clásico `places.Autocomplete` quedó cerrado a
// clientes nuevos en marzo de 2025, así que una llave creada hoy NO funciona
// con él. Pintamos nuestro propio desplegable (el mismo que usa el respaldo),
// de modo que la experiencia es idéntica con o sin Google. Las sugerencias se
// agrupan con un *session token*: Google cobra una sesión (teclear + elegir)
// en vez de cada pulsación.
//
// Sin llave, o si Google no carga (bloqueado, sin red, llave mal restringida),
// se pasa al respaldo en silencio: el campo manual nunca deja de funcionar.

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
 * respaldo abierto (Photon/OpenStreetMap). */
export function hasAddressAutocomplete() {
  return true;
}

// ── Carga del SDK de Google Maps (una sola vez) ─────────────────────────────
let scriptPromise = null;
// Google calls gm_authFailure AFTER the script loaded, so that promise is already
// resolved by then: a rejected key has to be remembered for the searches to see it.
let authFailed = false;

function loadGoogleMaps() {
  if (!GOOGLE_KEY) return Promise.reject(new Error("no-google-key"));
  if (typeof window === "undefined") return Promise.reject(new Error("no-window"));
  if (window.google && window.google.maps && window.google.maps.importLibrary) {
    return Promise.resolve(window.google);
  }
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("gmaps-sdk");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google));
      existing.addEventListener("error", reject);
      if (window.google && window.google.maps) resolve(window.google);
      return;
    }
    const s = document.createElement("script");
    s.id = "gmaps-sdk";
    s.async = true;
    s.defer = true;
    // `loading=async` es obligatorio con la API nueva; `v=weekly` trae
    // AutocompleteSuggestion. No se pide `libraries=` aquí: se importa luego.
    s.src =
      "https://maps.googleapis.com/maps/api/js?v=weekly&loading=async&key=" +
      encodeURIComponent(GOOGLE_KEY);
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error("gmaps-load-failed"));
    document.head.appendChild(s);
    // Si Google rechaza la llave (referrer no autorizado, API sin habilitar)
    // el script carga pero avisa por este callback global.
    window.gm_authFailure = () => {
      authFailed = true;
      reject(new Error("gmaps-auth-failed"));
    };
  });
  return scriptPromise;
}

/** Una sola línea, para los campos que guardan la dirección entera (tienda, perfil). */
export function formatAddressLine(parts) {
  const region = [parts.state, parts.postal_code].filter(Boolean).join(" ");
  return [parts.address_1, parts.city, region].filter(Boolean).join(", ");
}

// Convierte los `addressComponents` de un Place (API nueva: longText/shortText)
// en los campos separados del formulario. Las partes ausentes vuelven como ""
// para que el formulario conserve lo que el cliente ya tenía.
function parsePlaceComponents(comps) {
  const out = { address_1: "", postal_code: "", city: "", state: "", country: "", country_code: "" };
  let streetNumber = "";
  let route = "";
  for (const c of comps || []) {
    const types = c.types || [];
    const long = c.longText ?? c.long_name ?? "";
    const short = c.shortText ?? c.short_name ?? "";
    if (types.includes("street_number")) streetNumber = long;
    else if (types.includes("route")) route = long;
    else if (types.includes("postal_code")) out.postal_code = long;
    else if (types.includes("locality") || types.includes("postal_town")) out.city = long;
    else if (!out.city && types.includes("sublocality")) out.city = long;
    else if (!out.city && types.includes("administrative_area_level_2")) out.city = long;
    else if (types.includes("administrative_area_level_1")) out.state = short || long;
    else if (types.includes("country")) {
      out.country = long;
      out.country_code = short.toLowerCase();
    }
  }
  out.address_1 = [streetNumber, route].filter(Boolean).join(" ").trim();
  return out;
}

// ── Desplegable propio (compartido por Google y el respaldo) ────────────────
// `items`: [{ label, pick: () => Promise<parts> | parts }]
// `source`: de dónde vienen. Sugerencias sin mapa exigen atribución (políticas de
// Google Maps Platform: sin traducir y a la vista); también la licencia de OSM.
function makeSuggestBox(inputEl, onSelect, source) {
  const host = inputEl.parentElement;
  const prevPos = host.style.position;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  const box = document.createElement("div");
  box.className = "addr-sugg";
  box.style.display = "none";
  host.appendChild(box);
  inputEl.setAttribute("autocomplete", "off");

  const close = () => { box.style.display = "none"; box.innerHTML = ""; };
  const show = (items) => {
    box.innerHTML = "";
    // La respuesta llegó cuando el cursor ya estaba en otro campo.
    if (!items.length || document.activeElement !== inputEl) { close(); return; }
    items.forEach((item) => {
      const it = document.createElement("button");
      it.type = "button";
      it.className = "addr-sugg-it";
      it.textContent = item.label;
      // pointerdown (no click): gana al blur del input y la elección entra.
      it.addEventListener("pointerdown", async (e) => {
        e.preventDefault();
        close();
        try {
          const parts = await item.pick();
          if (parts) onSelect(parts);
        } catch { /* la selección falló: el cliente sigue tecleando */ }
      });
      box.appendChild(it);
    });
    const by = document.createElement("div");
    by.className = "addr-sugg-by";
    by.setAttribute("translate", "no");
    by.textContent = source;
    box.appendChild(by);
    box.style.display = "block";
  };
  const onBlur = () => setTimeout(close, 160);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  inputEl.addEventListener("blur", onBlur);
  inputEl.addEventListener("keydown", onKey);
  return {
    show,
    close,
    destroy() {
      inputEl.removeEventListener("blur", onBlur);
      inputEl.removeEventListener("keydown", onKey);
      box.remove();
      host.style.position = prevPos;
    },
  };
}

// Debounce del tecleo: devuelve { on, off } para engancharlo al input.
function debounceInput(inputEl, ms, fn) {
  let timer = null;
  const handler = () => { clearTimeout(timer); timer = setTimeout(() => fn(inputEl.value.trim()), ms); };
  inputEl.addEventListener("input", handler);
  return () => { clearTimeout(timer); inputEl.removeEventListener("input", handler); };
}

/**
 * Attach address autocomplete to a street input, or to a ZIP input.
 *
 * @param {HTMLInputElement} inputEl  the "street / address line 1" input, or the ZIP one
 * @param {(parts) => void}  onSelect  called with parsed { address_1,
 *   postal_code, city, state, country, country_code } when the user picks;
 *   `area: true` when what was found is a city or a ZIP, with no street
 * @param {{ mode?: "street" | "zip" }} [opts]  "zip": only digits are searched, and
 *   a complete ZIP with a single answer fills in without having to pick it
 * @returns {() => void} cleanup function; always safe to call
 */
export function attachAddressAutocomplete(inputEl, onSelect, { mode = "street" } = {}) {
  if (!inputEl) return () => {};
  if (!GOOGLE_KEY) return attachPhoton(inputEl, onSelect, mode);

  let cleanup = () => {};
  let cancelled = false;

  loadGoogleMaps()
    .then((google) => google.maps.importLibrary("places"))
    .then((places) => {
      if (cancelled) return;
      if (!places || !places.AutocompleteSuggestion) throw new Error("places-new-api-missing");
      cleanup = attachGoogle(inputEl, onSelect, places, mode);
    })
    .catch(() => {
      // Sin Google (llave mal, red, bloqueador): respaldo abierto.
      if (!cancelled) cleanup = attachPhoton(inputEl, onSelect, mode);
    });

  return () => {
    cancelled = true;
    cleanup();
  };
}

// ── Google Places (API nueva) ───────────────────────────────────────────────
function attachGoogle(inputEl, onSelect, places, mode) {
  const { AutocompleteSuggestion, AutocompleteSessionToken } = places;
  const ui = makeSuggestBox(inputEl, onSelect, "Google Maps");
  let token = new AutocompleteSessionToken();
  let seq = 0;

  let fallback = null;
  let off = () => {};

  // Google said no (key refused, API not enabled, quota): the rest of this field's
  // life goes to the open fallback, and the console says why. An empty answer is
  // not a failure, it just means no address matched.
  const giveUp = (reason) => {
    console.warn(`[address] Google Places unavailable, using OpenStreetMap: ${reason}. See docs/GOOGLE-MAPS.md.`);
    off();
    ui.destroy();
    fallback = attachPhoton(inputEl, onSelect, mode);
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  };

  off = debounceInput(inputEl, 250, async (q) => {
    if (q.length < 3 || (mode === "zip" && !/^\d+$/.test(q))) { ui.close(); return; }
    if (authFailed) { giveUp("the key was rejected"); return; }
    const my = ++seq;
    try {
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: q,
        sessionToken: token,
        // Solo direcciones de EE. UU. (la región y el envío son de EE. UU.).
        includedRegionCodes: ["us"],
        // Calles y edificios, y también ciudades y ZIP: quien empieza por "Katy" o
        // por "77449" debe ver algo. Google admite como máximo cinco tipos.
        includedPrimaryTypes: mode === "zip" ? ["postal_code"] : ["street_address", "premise", "route", "locality", "postal_code"],
        language: "en-US",
      });
      if (my !== seq) return; // llegó tarde: ya hay otra búsqueda en curso
      const items = (suggestions || [])
        .filter((s) => s.placePrediction)
        .slice(0, 5)
        .map((s) => ({
          label: s.placePrediction.text?.text || "",
          pick: async () => {
            const place = s.placePrediction.toPlace();
            await place.fetchFields({ fields: ["addressComponents"] });
            // La sesión termina al elegir: nuevo token para la siguiente búsqueda.
            token = new AutocompleteSessionToken();
            const parts = parsePlaceComponents(place.addressComponents);
            // Eligió una ciudad o un ZIP: rellena lo que hay, y la calle queda por escribir.
            const types = s.placePrediction.types || [];
            if (mode === "zip" || types.includes("locality") || types.includes("postal_code")) return { ...parts, address_1: "", area: true };
            // Dirección sin número (el cliente eligió solo la calle): se deja
            // el texto de la sugerencia para que complete el número a mano.
            if (!parts.address_1) parts.address_1 = s.placePrediction.mainText?.text || "";
            return parts;
          },
        }));
      if (mode === "zip" && /^\d{5}$/.test(q) && items.length === 1) {
        ui.close();
        const parts = await items[0].pick();
        if (my === seq) onSelect(parts);
        return;
      }
      ui.show(items);
    } catch (e) {
      ui.close();
      if (my === seq) giveUp(e?.message || "request failed");
    }
  });

  return () => {
    if (fallback) fallback();
    else { off(); ui.destroy(); }
  };
}

// ── Respaldo sin llave: Photon (OpenStreetMap) ──────────────────────────────
// Direcciones de EE. UU. con número y calle. Misma interfaz que Google.
//
// Por ZIP solo se rellena el estado: OSM conoce muchos códigos postales de EE. UU.
// sin su ciudad, o con la de al lado (90210 → Los Ángeles), y una ciudad equivocada
// es peor que un campo vacío. La ciudad con ZIP queda para Google.
function attachPhoton(inputEl, onSelect, mode) {
  const ui = makeSuggestBox(inputEl, onSelect, "© OpenStreetMap");
  let ctrl = null;

  const off = debounceInput(inputEl, 320, async (q) => {
    if (mode === "zip" && !/^\d{5}$/.test(q)) { ui.close(); return; }
    if (q.length < 4) { ui.close(); return; }
    try {
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      const r = await fetch(
        "https://photon.komoot.io/api/?limit=10&lang=en&q=" + encodeURIComponent(q),
        { signal: ctrl.signal }
      );
      const j = await r.json();
      if (mode === "zip") {
        const zip = (j.features || []).map((ft) => ft.properties || {}).find((pr) => pr.countrycode === "US" && pr.osm_value === "postcode" && pr.name === q);
        if (zip?.state) onSelect({ address_1: "", city: "", state: zip.state, postal_code: q, country: "United States", country_code: "us", area: true });
        return;
      }
      const feats = (j.features || []).filter((ft) => {
        const pr = ft.properties || {};
        return pr.countrycode === "US" && pr.street;
      });
      // OSM devuelve varias entidades para una misma dirección (edificio,
      // campus, portal): se muestra cada dirección una sola vez.
      const seen = new Set();
      ui.show(feats.map((ft) => {
        const pr = ft.properties;
        const street = [pr.housenumber, pr.street].filter(Boolean).join(" ");
        const cityName = pr.city || pr.town || pr.village || pr.district || "";
        return {
          label: [street, cityName, pr.state, pr.postcode].filter(Boolean).join(", "),
          pick: () => ({
            address_1: street,
            city: cityName,
            state: pr.state || "",
            postal_code: pr.postcode || "",
            country: "United States",
            country_code: "us",
          }),
        };
      }).filter((it) => (seen.has(it.label) ? false : (seen.add(it.label), true))).slice(0, 5));
    } catch { /* red caída o bloqueada: el campo manual sigue */ }
  });

  return () => { off(); if (ctrl) ctrl.abort(); ui.destroy(); };
}
