// Acciones de una fila o de un grupo de la matriz, A LA VISTA: iconos de
// editar, añadir y la papelera, en vez de esconderlas en el menú «⋯» (que solo
// asomaba al pasar el ratón). Mismo contrato que MoreMenu: cada acción lleva su
// icono, su etiqueta (title y aria-label) y su `onSelect`.
import Icon from "../../icons.jsx";

/**
 * @param actions [{ key, icon, label, onSelect, tone?: "danger", disabled? }]
 * @param label aria-label of the group
 */
export default function RowActions({ actions, label, children = null, className = "" }) {
  return (
    <span className={`pm-acts ${className}`} role="group" aria-label={label}>
      {children}
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          className={`pm-act ${a.tone === "danger" ? "danger" : ""}`}
          title={a.label}
          aria-label={a.label}
          disabled={a.disabled}
          onClick={(e) => { e.stopPropagation(); a.onSelect?.(); }}
        >
          <Icon name={a.icon} size={15} />
        </button>
      ))}
    </span>
  );
}
