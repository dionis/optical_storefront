// Set de iconos vectoriales (SVG) que replican las referencias entregadas por el
// cliente, en el estilo azul-navy de la marca. Trazo original y limpio para que
// escalen perfecto en cualquier tamaño y tomen el color por `currentColor`.
//
// Cada icono acepta { className } y hereda el color del contenedor.

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

// 360° — vista giratoria (probar con cámara). Doble flecha curva de rotación.
export function Icon360({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M8.5 8.5C5.4 9.2 3.3 10.8 3.3 12.7c0 1.6 1.6 3 4 3.7" />
      <path d="M15.5 8.5c3.1.7 5.2 2.3 5.2 4.2 0 1.6-1.6 3-4 3.7" />
      <polyline points="6.6 14.8 6.9 17.4 9.4 16.6" />
      <polyline points="17.4 14.8 17.1 17.4 14.6 16.6" />
    </svg>
  );
}

// Material — capas (rombo/diamante apilado), como la referencia.
export function IconMaterial({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M12 3 21.5 9 12 15 2.5 9z" />
      <path d="M3 12.2 12 18l9-5.8" />
      <path d="M3 15.4 12 21.2l9-5.8" />
    </svg>
  );
}

// Medidas — gafas redondas (dos aros + puente + varillas).
export function IconMeasures({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <circle cx="6.6" cy="13.4" r="3.9" />
      <circle cx="17.4" cy="13.4" r="3.9" />
      <path d="M10.5 12.6c.7-1 1.8-1 2.9 0" />
      <path d="M2.7 12.2C2.9 10 3.7 9.1 5.4 9" />
      <path d="M21.3 12.2C21.1 10 20.3 9.1 18.6 9" />
    </svg>
  );
}

// Género — símbolo masculino (círculo + flecha diagonal).
export function IconGender({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <circle cx="10" cy="14" r="6" />
      <path d="M14.5 9.5 20.5 3.5" />
      <polyline points="15.5 3.5 20.5 3.5 20.5 8.5" />
    </svg>
  );
}

// Filtros — embudo.
export function IconFilter({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M3.5 5.5h17l-6.6 7.6v5.1l-3.8 1.9v-7z" />
    </svg>
  );
}

// Ordenar — flechas arriba/abajo.
export function IconSort({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M7 4v15" /><polyline points="3.5 7.5 7 4 10.5 7.5" />
      <path d="M17 20V5" /><polyline points="13.5 16.5 17 20 20.5 16.5" />
    </svg>
  );
}

// --- Barra de confianza (referencia imagen 6) ---

// Envío — furgoneta de reparto.
export function IconTruck({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <rect x="1.5" y="6" width="12" height="9" rx="1.5" />
      <path d="M13.5 9h3.6l3.4 3.3V15h-7z" />
      <circle cx="6" cy="17" r="1.9" />
      <circle cx="17.5" cy="17" r="1.9" />
    </svg>
  );
}

// Compra segura — escudo con check.
export function IconShield({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M12 2.6 4.6 5.5v5.9c0 4.5 3.1 7.9 7.4 9.4 4.3-1.5 7.4-4.9 7.4-9.4V5.5z" />
      <path d="M8.6 12.1 11 14.5l4.6-4.7" />
    </svg>
  );
}

// Métodos de pago — tarjeta.
export function IconCard({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <rect x="2" y="5.5" width="20" height="13" rx="2.2" />
      <path d="M2 9.6h20" />
      <path d="M5.5 14.5h5" />
    </svg>
  );
}

// Asesoría en línea — audífonos con micrófono.
export function IconHeadset({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M4.5 13.5a7.5 7.5 0 0 1 15 0" />
      <rect x="2.6" y="13" width="3.6" height="6.2" rx="1.7" />
      <rect x="17.8" y="13" width="3.6" height="6.2" rx="1.7" />
      <path d="M19.6 19.2a3 3 0 0 1-3 3h-2.2" />
    </svg>
  );
}

// ================= Chrome (header, nav, acciones) =================
// Trazo consistente con el resto del set (currentColor + base 1.8).

// Menú — hamburguesa.
export function IconMenu({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M3.5 6.5h17" /><path d="M3.5 12h17" /><path d="M3.5 17.5h17" />
    </svg>
  );
}

// Buscar — lupa.
export function IconSearch({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" /><path d="M20.5 20.5 15.6 15.6" />
    </svg>
  );
}

// Carrito — bolsa de compra.
export function IconCart({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <circle cx="9" cy="20" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="20" r="1.7" fill="currentColor" stroke="none" />
      <path d="M2.3 4h2.6l2.1 10.4a1.7 1.7 0 0 0 1.66 1.35h7.8a1.7 1.7 0 0 0 1.63-1.25L21.3 7.5H6" />
    </svg>
  );
}

// Cuenta — usuario.
export function IconUser({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}

// Favoritos — corazón (relleno opcional con `filled`).
export function IconHeart({ className, filled }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base}
         fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path d="M12 20.5 4.3 12.9a4.8 4.8 0 0 1 6.8-6.8l.9.9.9-.9a4.8 4.8 0 0 1 6.8 6.8z" />
    </svg>
  );
}

// Cuadrícula — vista en rejilla.
export function IconGrid({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </svg>
  );
}

// Lista — vista en lista.
export function IconList({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M8.5 6.5h12" /><path d="M8.5 12h12" /><path d="M8.5 17.5h12" />
      <circle cx="4.4" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Inicio — casa.
export function IconHome({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M3.5 11.2 12 4l8.5 7.2" />
      <path d="M5.5 9.8V19a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1V9.8" />
    </svg>
  );
}

// Monturas — gafas (líneas limpias).
export function IconGlasses({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <rect x="2.5" y="9.5" width="7.5" height="5.6" rx="2.6" />
      <rect x="14" y="9.5" width="7.5" height="5.6" rx="2.6" />
      <path d="M10 11.6c.9-.8 3.1-.8 4 0" />
      <path d="M2.5 11.5C2.7 9.6 3.4 8.8 5 8.8" />
      <path d="M21.5 11.5C21.3 9.6 20.6 8.8 19 8.8" />
    </svg>
  );
}

// Lentes de sol — gafas de sol (aros rellenos).
export function IconSunglasses({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M2.4 9h6.4a1.4 1.4 0 0 1 1.4 1.6l-.3 2.3A2.6 2.6 0 0 1 7.3 15H6A2.6 2.6 0 0 1 3.4 12.7L2.4 9z" fill="currentColor" stroke="none" />
      <path d="M21.6 9h-6.4a1.4 1.4 0 0 0-1.4 1.6l.3 2.3A2.6 2.6 0 0 0 16.7 15H18a2.6 2.6 0 0 0 2.6-2.3L21.6 9z" fill="currentColor" stroke="none" />
      <path d="M2.4 9h19.2" /><path d="M10 10.8c.9-.7 3.1-.7 4 0" />
    </svg>
  );
}

// Ofertas — etiqueta de precio.
export function IconTag({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M3.5 12.5 11 5h6.5A1.5 1.5 0 0 1 19 6.5V13l-7.5 7.5a1.5 1.5 0 0 1-2.1 0l-5.9-5.9a1.5 1.5 0 0 1 0-2.1z" />
      <circle cx="15" cy="9" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Cámara — probar con cámara.
export function IconCamera({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.3l1.2-1.9h7.9L17.2 7h2.3A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

// Descuento — símbolo de porcentaje (para monturas en oferta).
export function IconDiscount({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...base} aria-hidden="true">
      <path d="M6.5 17.5 17.5 6.5" />
      <circle cx="8" cy="8" r="2.1" />
      <circle cx="16" cy="16" r="2.1" />
    </svg>
  );
}
