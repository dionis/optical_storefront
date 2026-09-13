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
