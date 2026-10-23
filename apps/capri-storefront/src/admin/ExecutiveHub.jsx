// Dónde se usa: sección Ejecutivo de /admin — cuatro vistas en pestañas, cada
// una pensada para caber en una sola pantalla: Ventas (foto del negocio),
// Costos operacionales (la misma foto mirando el gasto y el margen), Resumen
// (embudo, accesos, días de la semana) y Ventas en detalle (series + pedidos).
// Cada pestaña entera se exporta a PDF (imprimir) o CSV.
import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { SubTabs, ExportMenu } from "./ui.jsx";
import Executive from "./Executive.jsx";
import ExecutiveCosts from "./ExecutiveCosts.jsx";

export const EXEC_TABS = ["sales", "costs", "overview", "detail"];
const RANGES = ["today", "7d", "30d", "90d"];

export default function ExecutiveHub({ preset, setPreset, go, sub = "sales", onSub, views }) {
  const { t } = useLang();
  const [tab, setTab] = useState(EXEC_TABS.includes(sub) ? sub : "sales");
  const ref = useRef(null);
  useEffect(() => { if (EXEC_TABS.includes(sub)) setTab(sub); }, [sub]);
  const change = (k) => { setTab(k); onSub?.(k); };
  const items = [
    { key: "sales", icon: "dashboard", label: t("adm.exec.tab.sales") },
    { key: "costs", icon: "costs", label: t("adm.exec.tab.costs") },
    { key: "overview", icon: "overview", label: t("adm.tab.overview") },
    { key: "detail", icon: "sales", label: t("adm.tab.sales") },
  ];
  const title = `${t("adm.tab.exec")} · ${items.find((i) => i.key === tab)?.label || ""}`;
  return (
    <div className="adm-section adm-exec-hub">
      <div className="adm-head-row compact">
        <h2>{t("adm.exec.title")}</h2>
        <div className="adm-orders-tools">
          <div className="adm-range">
            {RANGES.map((k) => <button key={k} className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>{t(`adm.range.${k}`)}</button>)}
          </div>
          <ExportMenu targetRef={ref} title={title} name={`ejecutivo-${tab}`} compact={false} />
        </div>
      </div>
      <SubTabs items={items} value={tab} onChange={change} />
      <div ref={ref} className="adm-exec-view">
        {tab === "sales" && <Executive preset={preset} go={go} />}
        {tab === "costs" && <ExecutiveCosts preset={preset} go={go} />}
        {tab === "overview" && (views?.overview || <div className="adm-nodata"><Icon name="overview" /></div>)}
        {tab === "detail" && (views?.sales || <div className="adm-nodata"><Icon name="sales" /></div>)}
      </div>
    </div>
  );
}
