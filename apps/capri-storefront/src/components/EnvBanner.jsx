// Dónde se usa: App, encima de todo (tienda y panel). Franja fija que avisa de que
// esta compilación NO habla con el backend de producción. VITE_BACKEND_TARGET lo
// fija vercel.ts con la misma decisión que el rewrite de /medusa, así que la franja
// y el backend real nunca se contradicen. En producción vale "production" y no se
// pinta nada; en local (sin la variable) tampoco, para no ensuciar el desarrollo.
//
// Fija arriba (no `sticky`: el body lleva overflow-x hidden y lo anularía). Mientras
// se ve, reserva su alto (BANNER_H) en el body y baja ese mismo alto la barra lateral
// fija del panel y la cabecera de la tienda: así no tapa nada.
import { useLang } from "../i18n/LanguageContext.jsx";

const TARGET = import.meta.env.VITE_BACKEND_TARGET;
const BANNER_H = 28;

const CSS = `
body { padding-top: ${BANNER_H}px; }
.env-banner { position: fixed; top: 0; left: 0; right: 0; z-index: 10000; height: ${BANNER_H}px; padding: 0 16px;
  display: flex; align-items: center; justify-content: center; background: #b91c1c; color: #fff;
  font: 600 12.5px/1 system-ui, sans-serif; letter-spacing: .02em; white-space: nowrap; overflow: hidden; }
.env-banner span { overflow: hidden; text-overflow: ellipsis; }
.adm-side { top: ${BANNER_H}px !important; }
.header { top: ${BANNER_H}px !important; }
`;

export default function EnvBanner() {
  const { t } = useLang();
  if (!TARGET || TARGET === "production") return null;
  return (
    <>
      <style>{CSS}</style>
      <div className="env-banner" role="status">
        <span>{t(TARGET === "staging" ? "env.banner.staging" : "env.banner.custom")}</span>
      </div>
    </>
  );
}
