// Pedidos y etapas (StoreOrders.jsx): atrasados frente a la fecha prometida
// (HU-33) y lo que se añadió después del diccionario del Ejecutivo (exec.js).
// Claves adm.so.*. Parte propia para no pisar exec.js desde otra tarea.
export default {
  es: {
    "adm.so.late": "Atrasados",
    "adm.so.lateHint": "Pedidos sin entregar cuya fecha prometida al cliente ya pasó, deban o no saldo. La fecha es la que imprime el recibo de la venta.",
    "adm.so.lateDays": "{n} d",
    "adm.so.lateDaysHint": "Prometido para el {date}: lleva {n} día(s) de atraso",
    "adm.so.lateAlert": "{n} pasaron la fecha prometida sin entregarse",
    "adm.so.flt.lateOn": "Sí",
    "adm.so.stgCountsOnly": "Solo la cantidad por etapa: el importe lo ve únicamente el administrador.",
    "adm.so.col.sku": "SKU",
  },
  en: {
    "adm.so.late": "Late",
    "adm.so.lateHint": "Undelivered orders whose promised date has passed, whether or not a balance is owed. The date is the one printed on the sale's receipt.",
    "adm.so.lateDays": "{n} d",
    "adm.so.lateDaysHint": "Promised for {date}: {n} day(s) late",
    "adm.so.lateAlert": "{n} passed their promised date undelivered",
    "adm.so.flt.lateOn": "Yes",
    "adm.so.stgCountsOnly": "Counts per stage only: the amount is visible to the administrator alone.",
    "adm.so.col.sku": "SKU",
  },
};
