// Operaciones sobre una venta ya registrada (auditoría 5-nov-2026):
// cobrar el saldo y entregar en un solo paso (HU-32, SaleDetailPanel.jsx),
// aviso de anulación solicitada (HU-28, AlertRules.jsx) y la meta mensual de
// cada vendedor vista por el dueño (HU-40, SellerPanel.jsx). Parte propia para
// no chocar con sale-detail.js ni sellers.js.
export default {
  es: {
    "adm.ops.collectDeliver": "Cobrar saldo y entregar",
    "adm.ops.collectDeliver.hint": "Cobra todo el saldo y entrega los lentes en un solo paso. El pedido pasa a «Entregado».",
    "adm.ops.collectDeliver.full": "Para entregar hay que cobrar el saldo completo ({v}). Un cobro parcial se registra con «Registrar cobro».",
    "adm.ops.collectDeliver.confirm": "¿Cobrar {v} y entregar la venta {n}?",
    "adm.ops.collectDeliver.done": "Saldo cobrado y venta entregada",
    "adm.ops.deliver.body": "Se libera la bandeja y el pedido pasa a «Entregado» en Pedidos y en la hoja. Si el paciente pidió correo, recibe el aviso de entrega.",
    "adm.ops.goal.title": "Meta del mes",
    "adm.ops.goal.progress": "{done} de {goal} · {pct} %",
    "adm.ops.goal.left": "Faltan {left}",
    "adm.ops.goal.reached": "Meta alcanzada",
    "adm.ops.goal.none": "Sin meta mensual (se fija en el perfil de la persona).",
    "adm.ops.goal.base": "Sobre el neto del mes (sin impuesto), la misma base que la comisión.",
    "adm.alerts.ev.sale.void_requested": "Anulación solicitada (un vendedor pide anular)",
    "adm.audit.action.sale.deliver": "Entrega al paciente",
  },
  en: {
    "adm.ops.collectDeliver": "Collect balance and hand over",
    "adm.ops.collectDeliver.hint": "Collects the whole balance and hands the glasses over in one step. The order moves to “Delivered”.",
    "adm.ops.collectDeliver.full": "To hand over, the whole balance ({v}) must be collected. A part payment goes through “Record payment”.",
    "adm.ops.collectDeliver.confirm": "Collect {v} and hand over sale {n}?",
    "adm.ops.collectDeliver.done": "Balance collected and sale handed over",
    "adm.ops.deliver.body": "The tray is freed and the order moves to “Delivered” on the orders board and the sheet. If the customer asked for email, they get the delivery notice.",
    "adm.ops.goal.title": "Monthly goal",
    "adm.ops.goal.progress": "{done} of {goal} · {pct}%",
    "adm.ops.goal.left": "{left} to go",
    "adm.ops.goal.reached": "Goal reached",
    "adm.ops.goal.none": "No monthly goal (set in the person's profile).",
    "adm.ops.goal.base": "On the month's net (before tax), the same base as the commission.",
    "adm.alerts.ev.sale.void_requested": "Void requested (a seller asks to void)",
    "adm.audit.action.sale.deliver": "Handed over to the customer",
  },
};
