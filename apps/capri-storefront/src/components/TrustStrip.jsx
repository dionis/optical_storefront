import { useLang } from "../i18n/LanguageContext.jsx";
import { IconTruck, IconShield, IconCard, IconHeadset } from "./UiIcons.jsx";

// Franja de confianza (referencia imagen 6): iconos navy + texto gris, sin chip.
export default function TrustStrip() {
  const { t } = useLang();
  const items = [
    { key: "ship", label: t("trust.ship"), Icon: IconTruck },
    { key: "secure", label: t("trust.secure"), Icon: IconShield },
    { key: "pay", label: t("trust.pay"), Icon: IconCard },
    { key: "help", label: t("trust.help"), Icon: IconHeadset },
  ];
  return (
    <div className="truststrip">
      {items.map(({ key, label, Icon }) => (
        <div className="trust-item" key={key}>
          <Icon className="trust-ic" />
          <span className="trust-tx">{label}</span>
        </div>
      ))}
    </div>
  );
}
