// Iconos de MEDIDA de la ficha de montura del panel (AdminFrameCard).
//
// Por qué existe este fichero: el dueño pidió que la ficha del panel se vea
// como su tienda, y la tienda YA tiene estos iconos — no se dibuja ninguno
// nuevo. Se reutiliza el mismo arte 3D de `public/ui/icons3d/` que pinta la
// ficha de producto pública (ver `src/pages/ProductDetail.jsx`, que usa
// `/ui/icons3d/navy-eyewidth.png`), y como respaldo vectorial se importan los
// MISMOS componentes SVG de `src/components/measureIcons.jsx` que ya usan el
// probador y el flujo de receta. Aquí no se copia ningún fichero: solo se
// eligen y se envuelven.
//
// La única diferencia con la tienda es el modo oscuro, que la tienda pública no
// tiene: el arte viene en pareja (`navy-*` para fondo claro, `white-*` para
// fondo oscuro). Se pintan LAS DOS y el CSS esconde la que no toca
// (`.adm-frame-mi-navy` / `.adm-frame-mi-white` en admin.css), porque hacerlo
// por CSS evita re-montar la imagen al cambiar de tema y no necesita JS.
import { useState } from "react";
import { IconLensWidth, IconBridge, IconTemple, IconGlasses } from "../components/measureIcons.jsx";

// Qué arte de la tienda corresponde a cada medida del catálogo. `svg` es el
// respaldo vectorial (hereda currentColor, así que sirve en claro y en oscuro)
// por si el PNG no llega a cargar.
const ART = {
  eye_size: { art: "eyewidth", Svg: IconLensWidth },
  bridge_size: { art: "bridge", Svg: IconBridge },
  temple_length: { art: "temple", Svg: IconTemple },
  // Alto del lente: la tienda no tiene arte propio, así que se usa la regla —
  // el mismo icono que el probador ya muestra para "medir" (TryOnStudio).
  lens_height: { art: "ruler", Svg: IconGlasses },
};

/**
 * Icono de una medida concreta. `name` es la clave del atributo del catálogo
 * (eye_size, bridge_size, temple_length, lens_height).
 *
 * Decorativo a propósito (`aria-hidden`): el texto accesible lo pone el bloque
 * de la medida en AdminFrameCard con su `title`/`aria-label` traducidos, para
 * que el lector de pantalla lea "Tamaño del ojo: 51-53 milímetros" una sola vez
 * en vez de leer el icono y el número por separado.
 */
export default function FrameMeasureIcon({ name }) {
  const entry = ART[name];
  // `broken` se activa si el PNG no carga (offline, caché vacía): entonces se
  // pinta el SVG de la tienda, que nunca depende de la red.
  const [broken, setBroken] = useState(false);
  if (!entry) return null;
  const { art, Svg } = entry;

  if (broken) return <Svg className="adm-frame-mi adm-frame-mi-svg" />;

  return (
    <span className="adm-frame-mi-wrap" aria-hidden="true">
      <img className="adm-frame-mi adm-frame-mi-navy" src={`/ui/icons3d/navy-${art}.png`} alt=""
           loading="lazy" onError={() => setBroken(true)} />
      <img className="adm-frame-mi adm-frame-mi-white" src={`/ui/icons3d/white-${art}.png`} alt=""
           loading="lazy" />
    </span>
  );
}
