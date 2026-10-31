// Dónde se usa: ficha de vendedor y perfil de la persona. Una persona que vende
// tiene una sola dirección, guardada en esos dos sitios; si dicen cosas distintas,
// aquí decide quien está editando (lib/seller-address.ts en el backend).
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";

/**
 * `state`: "conflict" pide decidir; "separate" recuerda que hay dos a propósito.
 * `other`: la dirección del otro sitio. `place`: "profile" | "record", cuál es ese sitio.
 * `onChoose("this" | "other" | "separate")`.
 */
export default function AddressChoice({ state, other, place, busy, onChoose }) {
  const { t } = useLang();
  if (state !== "conflict" && state !== "separate") return null;
  const where = t(`adm.addr.place.${place}`);
  return (
    <div className="adm-demo-banner adm-addr-choice" role={state === "conflict" ? "alert" : "status"}>
      <Icon name="mapPin" size={15} />
      <span>{t(state === "conflict" ? "adm.addr.conflict" : "adm.addr.separate", { place: where, address: other || t("adm.addr.empty") })}</span>
      <span className="adm-addr-actions">
        <button type="button" disabled={busy} onClick={() => onChoose("this")}>{t("adm.addr.useThis")}</button>
        <button type="button" disabled={busy || !other} onClick={() => onChoose("other")}>{t("adm.addr.useOther", { place: where })}</button>
        {state === "conflict" && <button type="button" disabled={busy} onClick={() => onChoose("separate")}>{t("adm.addr.keepBoth")}</button>}
      </span>
    </div>
  );
}
