// Dónde se usa: la caja al terminar una venta (PosSale.jsx) y la ficha de la
// venta (SaleDetailPanel.jsx). Una venta registrada con datos pendientes (dueño,
// 17-nov-2026: «se debe poder registrar la venta aunque falten datos porque
// luego se puede editar») dice QUÉ falta y CÓMO completarlo, hasta que se
// completa. La lista viene del servidor (`sale.missing`, backend lib/pos.ts
// saleMissing): nombre, apellido, teléfono, dirección de envío, receta, anticipo.
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";

export default function MissingData({ missing, onComplete, completeLabel, compact = false }) {
  const { t } = useLang();
  const list = Array.isArray(missing) ? missing : [];
  if (!list.length) return null;
  return (
    <div className={`pos-missing ${compact ? "compact" : ""}`} role="status">
      <b className="pos-missing-title"><Icon name="alert" size={15} /> {t("adm.pos.missing.title", { n: list.length })}</b>
      <ul>
        {list.map((k) => (
          <li key={k}><b>{t(`adm.pos.missing.${k}`)}</b><span>{t(`adm.pos.missing.how.${k}`)}</span></li>
        ))}
      </ul>
      {onComplete && (
        <button type="button" className="btn-sm primary" onClick={onComplete}>
          <Icon name="edit" size={14} /> {completeLabel || t("adm.pos.missing.complete")}
        </button>
      )}
    </div>
  );
}
