// Dónde se usa: Vendedores (/admin), panel público del vendedor (/vendedor) y
// Ejecutivo — iconos por red social y el bloque "un enlace por red" compartido.
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { shareLinks } from "./adminSellers.js";

export const SOURCE_ICON = { instagram: "instagram", facebook: "facebook", tiktok: "tiktok", whatsapp: "whatsapp", telegram: "message", x: "share", email: "mail", link: "link", other: "globe" };

/**
 * Un enlace por red social (`?ref=CODIGO&src=instagram`…): al compartirlo desde
 * cada red, la venta queda atribuida al vendedor Y a la red que la trajo. Cada
 * fila: compartir (abre la app si tiene cuadro de compartir; si no, copia el
 * texto listo para pegar) + copiar solo el enlace + ventas que llegaron por ahí.
 */
export const SOURCES = ["instagram", "facebook", "tiktok", "whatsapp", "telegram", "x", "email"];
export function SocialLinks({ seller, text, stat, onCopy, big = false }) {
  const { t } = useLang();
  const links = seller.social_links || {};
  const bySrc = Object.fromEntries((stat?.by_source || []).map((x) => [x.source, x]));
  const label = (k) => (t(`adm.src.${k}`) === `adm.src.${k}` ? k : t(`adm.src.${k}`));
  return (
    <div className={`sel-social ${big ? "big" : ""}`}>
      {SOURCES.map((k) => {
        const url = links[k] || seller.referral_url;
        const share = shareLinks(url, text);
        const direct = { whatsapp: share.whatsapp, facebook: share.facebook, telegram: share.telegram, x: share.x, email: share.mail }[k];
        const n = bySrc[k]?.orders || 0;
        return (
          <div className="sel-social-row" key={k}>
            {direct
              ? <a className="sel-social-main" href={direct} target="_blank" rel="noopener noreferrer" title={t("adm.sel.shareOn", { net: label(k) })}><Icon name={SOURCE_ICON[k]} size={15} /><span>{label(k)}</span></a>
              : <button type="button" className="sel-social-main" onClick={() => onCopy(`${text} ${url}`, t("adm.sel.copiedPost"))} title={t("adm.sel.copyPostFor", { net: label(k) })}><Icon name={SOURCE_ICON[k]} size={15} /><span>{label(k)}</span></button>}
            <code title={url}>{url.replace(/^https?:\/\//, "")}</code>
            <button type="button" className="adm-mini" onClick={() => onCopy(url, t("adm.sel.copied"))} title={t("adm.sel.copyLink")}><Icon name="copy" size={13} /></button>
            <span className={`adm-chip ${n ? "ok" : "neutral"}`} title={t("adm.sel.salesVia", { net: label(k) })}>{n}</span>
          </div>
        );
      })}
    </div>
  );
}

