// Períodos recién empezados (periodStore.js, EmptyPeriod.jsx, GlobalFilterBar.jsx):
// el aviso de «sin datos en este período» con sus botones de salto y el aviso de
// que el panel cambió el período solo. Claves adm.period.*; los NOMBRES de cada
// período siguen en exec.js (adm.ex.period.* / adm.ex.per.*) porque los comparte
// la barra de filtros.
export default {
  es: {
    // Aviso de período vacío (EmptyPeriod.jsx)
    "adm.period.empty.aria": "Período sin datos",
    "adm.period.empty.sales": "Sin ventas en este período",
    "adm.period.empty.salesSub": "No se registró ninguna venta entre esas dos fechas. Lo anterior sigue ahí: prueba otro período.",
    "adm.period.empty.cash": "Sin movimientos de caja en este período",
    "adm.period.empty.cashSub": "No hubo cobros ni entradas o salidas de efectivo entre esas dos fechas.",
    "adm.period.empty.orders": "Sin pedidos en este período",
    "adm.period.empty.ordersSub": "Ningún pedido entró entre esas dos fechas. Lo anterior sigue ahí: prueba otro período.",
    "adm.period.empty.current": "Período: {period}",
    "adm.period.empty.dates": "{from} – {to}",
    "adm.period.empty.try": "Prueba otro período",
    "adm.period.empty.goTo": "Ver {period}",
    "adm.period.empty.noAlt": "Cambia el período en la barra de filtros de arriba.",
    // Aviso de salto automático (GlobalFilterBar.jsx)
    "adm.period.auto.aria": "El panel cambió el período",
    "adm.period.auto.notice": "{from} aún no tiene ventas: mostrando {to}.",
    "adm.period.auto.dismiss": "Entendido",
  },
  en: {
    "adm.period.empty.aria": "Period with no data",
    "adm.period.empty.sales": "No sales in this period",
    "adm.period.empty.salesSub": "No sale was recorded between those two dates. Earlier data is still there: try another period.",
    "adm.period.empty.cash": "No cash movements in this period",
    "adm.period.empty.cashSub": "No payments and no cash in or out between those two dates.",
    "adm.period.empty.orders": "No orders in this period",
    "adm.period.empty.ordersSub": "No order came in between those two dates. Earlier data is still there: try another period.",
    "adm.period.empty.current": "Period: {period}",
    "adm.period.empty.dates": "{from} – {to}",
    "adm.period.empty.try": "Try another period",
    "adm.period.empty.goTo": "Show {period}",
    "adm.period.empty.noAlt": "Change the period in the filter bar above.",
    "adm.period.auto.aria": "The panel changed the period",
    "adm.period.auto.notice": "{from} has no sales yet: showing {to}.",
    "adm.period.auto.dismiss": "Got it",
  },
};
