// Dónde se usa: Ejecutivo, Ventas de tienda, Caja, Estado de cuenta y toda
// pantalla que agrupe información. Un acordeón con RESUMEN EJECUTIVO en la
// cabecera: antes de abrirlo ya se lee lo esencial (conteo, total, ganancia,
// variación, alertas) como pastillas; al abrir, el detalle. El estado abierto
// se recuerda por `id` en localStorage (clave adm.acc.<id>).
//
// <Accordion id="ventas" icon="sales" title="Ventas del período"
//   summary={[{ label: "ventas", value: 27 }, { label: "total", value: "$4,320", strong: true }, { label: "vs. ayer", value: "+12%", tone: "good" }]}
//   defaultOpen right={<ExportMenu …/>}>…</Accordion>
import { useEffect, useState } from "react";
import Icon from "./icons.jsx";
import "./accordion.css";

const KEY = (id) => `adm.acc.${id}`;
const readOpen = (id, fallback) => { try { const v = localStorage.getItem(KEY(id)); return v === null ? fallback : v === "1"; } catch { return fallback; } };

/** `summary`: [{ label, value, strong?, tone?: "good"|"bad"|"warn"|"muted", hint? }] — se pintan como pastillas en la cabecera. */
export function SummaryPills({ items = [], className = "" }) {
  if (!items.length) return null;
  return (
    <span className={`acc-pills ${className}`}>
      {items.filter(Boolean).map((p, i) => (
        <span key={i} className={`acc-pill ${p.tone || ""} ${p.strong ? "strong" : ""}`} title={p.hint || undefined}>
          {p.label && <small>{p.label}</small>}
          <b>{p.value}</b>
        </span>
      ))}
    </span>
  );
}

export default function Accordion({ id, icon, title, subtitle, summary = [], badge, right, defaultOpen = false, open: controlled, onToggle, className = "", bodyClassName = "", children }) {
  const [open, setOpen] = useState(() => (controlled ?? readOpen(id, defaultOpen)));
  useEffect(() => { if (controlled !== undefined) setOpen(controlled); }, [controlled]);
  const toggle = (e) => {
    e.preventDefault();
    const next = !open;
    setOpen(next);
    try { if (id) localStorage.setItem(KEY(id), next ? "1" : "0"); } catch { /* noop */ }
    onToggle?.(next);
  };
  return (
    <details className={`adm-acc ${className}`} open={open} data-acc={id}>
      <summary onClick={toggle}>
        <span className="acc-head-main">
          {icon && <span className="acc-ico"><Icon name={icon} size={16} /></span>}
          <span className="acc-titles">
            <span className="acc-title">{title}{badge != null && <span className="acc-badge">{badge}</span>}</span>
            {subtitle && <span className="acc-sub">{subtitle}</span>}
          </span>
        </span>
        <SummaryPills items={summary} />
        {right && <span className="acc-right adm-noprint" onClick={(e) => e.stopPropagation()}>{right}</span>}
        <Icon name="chevronDown" size={16} className="acc-arrow" />
      </summary>
      <div className={`acc-body ${bodyClassName}`}>{open ? children : null}</div>
    </details>
  );
}

/** Lista de acordeones con separación uniforme. */
export function AccordionGroup({ children, className = "" }) {
  return <div className={`adm-acc-group ${className}`}>{children}</div>;
}
