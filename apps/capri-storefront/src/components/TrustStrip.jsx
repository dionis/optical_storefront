// Dónde se usa: pie de todas las páginas (dentro de Footer) — 4 garantías de la tienda. En móvil se reparte en 2×2.
import { useLang } from "../i18n/LanguageContext.jsx";
import { IconTruck, IconShield, IconCard, IconHeadset } from "./UiIcons.jsx";

// Franja de confianza (referencia imagen 6): iconos navy + texto gris, sin chip.
export default function TrustStrip() {
  const { t } = useLang();
  const items = [
    { key: "ship", label: t("trust.ship"), Icon: IconTruck, i3d: "navy-truck" },
    { key: "secure", label: t("trust.secure"), Icon: IconShield, i3d: "navy-shield" },
    { key: "pay", label: t("trust.pay"), Icon: IconCard, i3d: "navy-card" },
    { key: "help", label: t("trust.help"), Icon: IconHeadset, i3d: "navy-headset" },
  ];
  return (
    <div className="truststrip">
      {items.map(({ key, label, Icon, i3d }) => (
        <div className="trust-item" key={key}>
          {/* Icono 3D navy de la lámina (camión/escudo/tarjeta/auricular);
              respaldo: el svg de línea de siempre. */}
          <img className="i3d i3d-trust" src={`/ui/icons3d/${i3d}.png`} alt=""
               onError={(e) => { e.currentTarget.parentElement.classList.add("no-i3d"); e.currentTarget.remove(); }} />
          <Icon className="trust-ic" />
          <span className="trust-tx">{label}</span>
        </div>
      ))}
    </div>
  );
}
