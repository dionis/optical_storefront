// Dónde se usa: pasos Montura y Lentes de Nueva venta, y resumen de la venta.
// La foto de la montura elegida, como referencia para quien vende y para el
// cliente: la del catálogo o la que se subió de la montura que trae el cliente.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { resolveImageSized } from "../data/imageUrl.js";
import Icon from "./icons.jsx";

/** `line`: línea de la venta en PosSale.jsx. `size="md"` la reduce para acompañar a un formulario. */
export default function PosFramePhoto({ line, size = "" }) {
  const { t } = useLang();
  // La que se escribe a mano (del paciente o de la tienda fuera de catálogo) lleva la foto que se tomó.
  const own = line?.kind === "own_frame" || line?.kind === "store_frame";
  const src = own ? line.photo : line?.image && resolveImageSized(line.image, 640);
  const [brokenSrc, setBrokenSrc] = useState(null);
  if (!src || src === brokenSrc) return <div className={`pos-frame-photo noimg ${size}`}><Icon name={own ? "camera" : "glasses"} size={28} /></div>;
  return <img className={`pos-frame-photo ${size}`} src={src} alt={own ? t("adm.pos.own.tag") : line.title} onError={() => setBrokenSrc(src)} />;
}
