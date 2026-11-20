// Dónde se usa: bajo los campos de los formularios del panel y del checkout.
import { useLang } from "../i18n/LanguageContext.jsx";

/** `error`: clave del diccionario (data/fieldRules.js), o nada. */
export default function FieldError({ error }) {
  const { t } = useLang();
  return error ? <small className="field-err" role="alert">{t(error)}</small> : null;
}
