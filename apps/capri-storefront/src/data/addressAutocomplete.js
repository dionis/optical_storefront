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
    window.gm_authFailure = () => reject(new Error("gmaps-auth-failed"));
  });
  return scriptPromise;
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
function makeSuggestBox(inputEl, onSelect) {
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
    if (!items.length) { close(); return; }
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
 * Attach address autocomplete to a street input.
 *
 * @param {HTMLInputElement} inputEl  the "street / address line 1" input
 * @param {(parts) => void}  onSelect  called with parsed { address_1,
 *   postal_code, city, state, country, country_code } when the user picks
 * @returns {() => void} cleanup function; always safe to call
 */
export function attachAddressAutocomplete(inputEl, onSelect) {
  if (!inputEl) return () => {};
  if (!GOOGLE_KEY) return attachPhoton(inputEl, onSelect);

  let cleanup = () => {};
  let cancelled = false;

  loadGoogleMaps()
    .then((google) => google.maps.importLibrary("places"))
    .then((places) => {
      if (cancelled) return;
      if (!places || !places.AutocompleteSuggestion) throw new Error("places-new-api-missing");
      cleanup = attachGoogle(inputEl, onSelect, places);
    })
    .catch(() => {
      // Sin Google (llave mal, red, bloqueador): respaldo abierto.
      if (!cancelled) cleanup = attachPhoton(inputEl, onSelect);
    });

  return () => {
    cancelled = true;
    cleanup();
  };
}

// ── Google Places (API nueva) ───────────────────────────────────────────────
function attachGoogle(inputEl, onSelect, places) {
  const { AutocompleteSuggestion, AutocompleteSessionToken } = places;
  const ui = makeSuggestBox(inputEl, onSelect);
  let token = new AutocompleteSessionToken();
  let seq = 0;

  const off = debounceInput(inputEl, 250, async (q) => {
    if (q.length < 3) { ui.close(); return; }
    const my = ++seq;
    try {
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: q,
        sessionToken: token,
        // Solo direcciones de EE. UU. (la región y el envío son de EE. UU.).
        includedRegionCodes: ["us"],
        includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
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
            // Dirección sin número (el cliente eligió solo la calle): se deja
            // el texto de la sugerencia para que complete el número a mano.
            if (!parts.address_1) parts.address_1 = s.placePrediction.mainText?.text || "";
            return parts;
          },
        }));
      ui.show(items);
    } catch {
      ui.close(); // cuota agotada o error de red: el campo manual sigue
    }
  });

  return () => { off(); ui.destroy(); };
}

// ── Respaldo sin llave: Photon (OpenStreetMap) ──────────────────────────────
// Direcciones de EE. UU. con número y calle. Misma interfaz que Google.
function attachPhoton(inputEl, onSelect) {
  const ui = makeSuggestBox(inputEl, onSelect);
  let ctrl = null;

  const off = debounceInput(inputEl, 320, async (q) => {
    if (q.length < 4) { ui.close(); return; }
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
      }));
    } catch { /* red caída o bloqueada: el campo manual sigue */ }
  });

  return () => { off(); if (ctrl) ctrl.abort(); ui.destroy(); };
}
