// Fotos pequeñas de «Productos y precios»: la miniatura de un modelo y el logo
// de una marca. Nunca el icono roto del navegador: si la imagen no llega (una
// clave de R2 vieja, un enlace caído), se pinta un marco neutro con el icono
// de la sección o, para una marca, su monograma de color.
//
// Las URL llegan absolutas del servidor (v2); un logo sembrado puede venir
// relativo («/brands/logo-di-caprio.png»), que sirve el mismo origen del panel.
import { useEffect, useState } from "react";
import Icon from "../../icons.jsx";
import { monogram, monogramTone } from "./model.js";

/** Model thumbnail: rounded, object-fit contain on white, lazy. */
export function Thumb({ src, icon = "glasses", size = 40, className = "", alt = "" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const ok = Boolean(src) && !failed;
  return (
    <span className={`pm-thumb ${ok ? "has-img" : "is-empty"} ${className}`.trim()} style={{ "--th": `${size}px` }} aria-hidden={alt ? undefined : "true"}>
      {ok
        ? <img src={src} alt={alt} loading="lazy" decoding="async" width={size} height={size} onError={() => setFailed(true)} />
        : <Icon name={icon} size={Math.round(size * 0.5)} strokeWidth={1.6} />}
    </span>
  );
}

/** Brand logo; without one (or when it fails) a coloured monogram chip. */
export function BrandLogo({ src, name, slug, className = "" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed) {
    return (
      <span className={`pm-logo ${className}`.trim()} aria-hidden="true">
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className={`pm-logo pm-mono t${monogramTone(slug || name)} ${className}`.trim()} aria-hidden="true">
      {monogram(name)}
    </span>
  );
}
