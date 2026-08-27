import { lazy, Suspense } from "react";

// ── Switch de interfaz del probador (try-on) ────────────────────────────────
//
// Hay TRES interfaces, y NINGUNA se elimina. Este selector decide cuál se monta
// en los puntos de entrada (ProductCard, ProductDetail), que importan ESTE
// archivo en vez de un componente fijo. Todas comparten la misma firma de props
// (`product`, `colorIdx`, `onClose`), así que cambiar entre ellas es transparente.
//
//   clave      componente          rol
//   ─────────  ──────────────────  ───────────────────────────────────────────
//   "prod"     TryOnStudio.jsx     NUEVA UI de cliente (derivada de TryOn.jsx).
//   "dev"      TryOn.jsx           RESPALDO: motor procedural + calibración
//                                  (?tryonDebug=1). No se toca salvo petición.
//   "legacy"   TryOn3D.jsx         Iframe a apps/vto-web (lo que ve el cliente HOY).
//
// Cómo se elige (precedencia): URL  >  variable de entorno  >  default.
//   1) URL, sin recompilar:  ?tryonUi=prod | ?tryonUi=dev | ?tryonUi=legacy
//   2) Build:                VITE_TRYON_UI = prod | dev | legacy   (.env / Vercel)
//   3) Default:              "legacy"  ← mantiene EXACTAMENTE lo que el cliente
//      ve hoy (vto-web) mientras no se verifique la nueva. Para que el cliente
//      vea la nueva: poner VITE_TRYON_UI=prod (o cambiar DEFAULT_UI abajo).
//
// Documentado en detalle en el README (sección "Probador (try-on)").

const UIS = {
  prod: lazy(() => import("./TryOnStudio.jsx")),
  dev: lazy(() => import("./TryOn.jsx")),
  legacy: lazy(() => import("./TryOn3D.jsx")),
};

// Cambia esta línea (o pon VITE_TRYON_UI) el día que la nueva quede validada.
const DEFAULT_UI = "legacy";

function resolveKey() {
  // 1) Override por URL (útil para probar en el sitio ya desplegado).
  if (typeof window !== "undefined") {
    try {
      const q = new URLSearchParams(window.location.search).get("tryonUi");
      if (q && UIS[q.toLowerCase()]) return q.toLowerCase();
    } catch {
      /* URLSearchParams no disponible → seguimos con env/default */
    }
  }
  // 2) Variable de entorno (inyectada en build por Vite).
  const env = (typeof import.meta !== "undefined" && import.meta.env?.VITE_TRYON_UI) || "";
  const key = String(env).trim().toLowerCase();
  if (UIS[key]) return key;
  // 3) Default.
  return DEFAULT_UI;
}

/** Punto único de entrada del probador. Misma firma que cada interfaz. */
export default function TryOnSwitch(props) {
  const Ui = UIS[resolveKey()] || UIS[DEFAULT_UI];
  return (
    <Suspense fallback={null}>
      <Ui {...props} />
    </Suspense>
  );
}
