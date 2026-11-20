// Dónde se usa: «Precios y costos» (PricingPanel.jsx) y su segundo nivel de
// lentes. Guarda CUÁL pestaña está abierta.
//
// Por qué un módulo y no `useState` a secas: el dueño entra a una pestaña
// concreta («los lentes»), recarga, y tiene que seguir ahí; y un enlace pegado
// en un correo tiene que abrir esa misma pestaña. El panel ya tiene ese
// parámetro para sub-pestañas: `?sub=` en la URL, que `AdminDashboard` lee al
// arrancar (`navFromUrl`) y reparte como `params.sub` + `onSub` (así lo hacen
// `ExecutiveHub` y `Costs`).
//
// PricingPanel todavía NO recibe `params`/`onSub` del armazón (ver el informe:
// hace falta una línea en AdminDashboard.jsx, que no se toca aquí). Hasta
// entonces el respaldo es leer y escribir `?sub=` nosotros mismos con
// `history.replaceState` — el mismo parámetro y el mismo formato, así que el
// día que el armazón los pase, los props mandan y esto no estorba ni duplica.
import { useCallback, useEffect, useState } from "react";

/** `?sub=` de la URL actual, o null (SSR, URL rara, navegador sin History). */
const readUrlSub = () => {
  try {
    return new URLSearchParams(window.location.search).get("sub") || null;
  } catch {
    return null;
  }
};

/**
 * Escribe `?sub=` SIN tocar el resto de la consulta (`tab`, `mode` del banco de
 * pruebas…) y sin apilar entradas en el historial: cambiar de pestaña no es
 * navegar, así que el botón «atrás» sigue saliendo del panel.
 */
const writeUrlSub = (value) => {
  try {
    const u = new URL(window.location.href);
    if (value) u.searchParams.set("sub", value);
    else u.searchParams.delete("sub");
    window.history.replaceState({}, "", u.toString());
  } catch {
    /* sin History no hay enlace profundo, pero la pestaña funciona igual */
  }
};

/**
 * @param normalize (v) => valor válido | null. Función ESTABLE (de módulo): se
 *        usa dentro de un efecto y no debe cambiar en cada pintado.
 * @param fallback  pestaña por defecto cuando no hay nada válido.
 * @param sub       `params.sub` del armazón, si algún día llega.
 * @param onSub     `onSub` del armazón, si algún día llega.
 * @returns [valor, elegir]
 */
export default function useSubTab({ normalize, fallback, sub = null, onSub = null }) {
  const [view, setView] = useState(() => normalize(sub) || normalize(readUrlSub()) || fallback);

  // Un salto entrante — go("pricing", { sub: "lenses-prog" }) — manda sobre lo
  // que estuviera abierto; un `sub` que no existe se ignora, no cierra nada.
  useEffect(() => {
    const next = normalize(sub);
    if (next) setView(next);
  }, [sub]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback(
    (next) => {
      setView(next);
      writeUrlSub(next);
      onSub?.(next);
    },
    [onSub]
  );

  return [view, pick];
}
