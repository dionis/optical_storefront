// La comisión por defecto del dueño («Reglas y comisiones»), para los
// formularios que crean un vendedor (Vendedores, Equipo): arrancan con ella en
// vez de un número propio. Es la única fuente; si el formulario va vacío, el
// servidor aplica la misma (POST /admin/sellers, lib/seller-link.ts).
// Devuelve el % como texto ("" mientras carga o si nunca se fijó).
import { useEffect, useState } from "react";
import { fetchDefaultCommission } from "./financeApi.js";

let cached = null;

export default function useDefaultCommission() {
  const [pct, setPct] = useState(cached);
  useEffect(() => {
    let off = false;
    fetchDefaultCommission()
      .then((v) => { cached = v == null ? "" : String(v); if (!off) setPct(cached); })
      .catch(() => { if (!off) setPct((p) => p ?? ""); });
    return () => { off = true; };
  }, []);
  return pct ?? "";
}
