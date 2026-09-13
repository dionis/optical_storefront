import { useLang } from "../i18n/LanguageContext.jsx";

// Franja de confianza: envío, compra segura, métodos de pago, asesoría.
// Reutilizable — se muestra al pie del catálogo (y donde haga falta).
export default function TrustStrip() {
  const { t } = useLang();
  const items = [
    {
      key: "ship",
      label: t("trust.ship"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4h11v10H1z" /><path d="M12 7h4.5l3.5 3.5V14H12z" /><circle cx="5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg>
      ),
    },
    {
      key: "secure",
      label: t("trust.secure"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5v-6z" /><path d="M9 12l2 2 4-4" /></svg>
      ),
    },
    {
      key: "pay",
      label: t("trust.pay"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.4" /><path d="M2 9.5h20" /><path d="M6 15h4" /></svg>
      ),
    },
    {
      key: "help",
      label: t("trust.help"),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13a8 8 0 0 1 16 0" /><rect x="2.5" y="13" width="4" height="6" rx="2" /><rect x="17.5" y="13" width="4" height="6" rx="2" /><path d="M20 19a3 3 0 0 1-3 3h-3" /></svg>
      ),
    },
  ];
  return (
    <div className="truststrip">
      {items.map((it) => (
        <div className="trust-item" key={it.key}>
          <span className="trust-ic">{it.icon}</span>
          <span className="trust-tx">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
