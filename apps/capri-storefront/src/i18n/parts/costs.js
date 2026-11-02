// Ejecutivo → «Costos y margen» (admin/ExecutiveCosts.jsx, admin/charts.jsx
// CompareBarChart): etiquetas de una palabra para los KPI, glosario de costos,
// detalle del reparto, ventas por vendedor con sus canales, la gráfica
// «Ventas vs costo por día» y las guías de ayuda `adm.help.cost.*` (HelpTip),
// escritas para quien nunca ha leído un estado de resultados. Español primero;
// inglés con las mismas claves. Se registra en parts/index.js.

const UI = {
  es: {
    // KPI (una palabra; la guía explica el resto)
    "adm.ecost.kpi.paid": "Pagado",
    "adm.ecost.kpi.net": "Neto",
    "adm.ecost.kpi.cost": "Costo",
    "adm.ecost.kpi.profit": "Ganancia",
    "adm.ecost.kpi.target": "Objetivo",
    "adm.ecost.kpi.incomplete": "Incompletas",
    "adm.ecost.kpi.ofNet": "{pct} del neto",
    "adm.ecost.kpi.deducted": "−{v} deducido",
    "adm.ecost.kpi.costSub": "materiales {m} · resto {p}",
    "adm.ecost.kpi.targetSub": "faltan {v}",
    "adm.ecost.kpi.targetOk": "sobran {v}",
    "adm.ecost.kpi.incompleteSub": "pedidos con un costo en 0",
    // Glosario
    "adm.ecost.gl.title": "Qué incluye cada costo",
    "adm.ecost.gl.sub": "Cada concepto en una línea, en el orden en que se descuenta del dinero pagado.",
    "adm.ecost.gl.step": "Paso {n}",
    "adm.ecost.gl.deduction.name": "Deducciones",
    "adm.ecost.gl.deduction.def": "Dinero que el cliente pagó pero nunca fue tuyo: se va antes de contar nada.",
    "adm.ecost.gl.deduction.items": "Envío · Impuestos · Comisión de Stripe (tarjeta)",
    "adm.ecost.gl.material.name": "Materiales",
    "adm.ecost.gl.material.def": "Lo que compras para fabricar ese pedido, a precio de proveedor (importe fijo por pieza).",
    "adm.ecost.gl.material.items": "Montura · Lentes · Tratamientos (antirreflejo, fotocromático) · Estuche",
    "adm.ecost.gl.percent.name": "Partidas %",
    "adm.ecost.gl.percent.def": "Gastos del negocio repartidos como un porcentaje del neto de cada venta.",
    "adm.ecost.gl.percent.items": "Laboratorio · Empaque · Mantenimiento · Atención al cliente · Renta · Reserva",
    "adm.ecost.gl.seller.name": "Vendedor",
    "adm.ecost.gl.seller.def": "La comisión de quien trajo la venta: su % sobre el neto del pedido.",
    "adm.ecost.gl.seller.items": "Comisión del vendedor (según su ficha)",
    "adm.ecost.gl.manual.name": "Ajuste manual",
    "adm.ecost.gl.manual.def": "Un costo extra que anotaste a mano en la ficha de ese pedido.",
    "adm.ecost.gl.manual.items": "Mensajería extra · Reposición · Cualquier gasto puntual",
    "adm.ecost.gl.profit.name": "Ganancia",
    "adm.ecost.gl.profit.def": "Lo que queda para el dueño después de todo lo anterior. El objetivo es el % del neto que quieres conservar.",
    "adm.ecost.gl.profit.items": "Ganancia real · Ganancia objetivo (p. ej. 30 % del neto)",
    // Reparto
    "adm.ecost.split.detail": "Detalle del reparto",
    "adm.ecost.split.detailSub": "{n} conceptos",
    "adm.ecost.col.group": "Grupo",
    "adm.ecost.col.concept": "Concepto",
    "adm.ecost.col.amount": "Importe",
    "adm.ecost.col.pct": "%",
    // Vendedores
    "adm.ecost.sellers.title": "Ventas por vendedor",
    "adm.ecost.sellers.hint": "Total vendido por cada vendedor en el período y por qué red llegó cada venta. Clic en el vendedor: su panel.",
    "adm.ecost.sellers.open": "Abrir el panel de {name}",
    "adm.ecost.sellers.none": "Ninguna venta con vendedor en este período.",
    "adm.ecost.sellers.unassigned": "{n} sin vendedor · {v}",
    "adm.ecost.sellers.orders": "{n} pedidos",
    "adm.ecost.sellers.via": "{n} por {net}",
    "adm.ecost.sellers.channels": "Ventas por red",
    // Ventas vs costo
    "adm.ecost.cmp.title": "Ventas vs costo por día",
    "adm.ecost.cmp.hint": "Cada día, lo vendido junto a lo que costó; el % sobre cada par es el margen del día (ganancia ÷ ventas).",
    "adm.ecost.cmp.name": "ventas-vs-costo",
    "adm.ecost.cmp.sheet": "Por día",
    "adm.chart.sales": "Ventas",
    "adm.chart.cost": "Costo",
    "adm.chart.profit": "Ganancia",
    "adm.chart.margin": "Margen",
    "adm.chart.ariaCompare": "Gráfico de barras: {sales} y {cost} por día, {n} días",
    // Últimos pedidos
    "adm.ecost.recent.net": "neto {v}",
    "adm.help.group.cost": "Costos y margen",
  },
  en: {
    "adm.ecost.kpi.paid": "Paid",
    "adm.ecost.kpi.net": "Net",
    "adm.ecost.kpi.cost": "Cost",
    "adm.ecost.kpi.profit": "Profit",
    "adm.ecost.kpi.target": "Target",
    "adm.ecost.kpi.incomplete": "Incomplete",
    "adm.ecost.kpi.ofNet": "{pct} of net",
    "adm.ecost.kpi.deducted": "−{v} deducted",
    "adm.ecost.kpi.costSub": "materials {m} · rest {p}",
    "adm.ecost.kpi.targetSub": "{v} short",
    "adm.ecost.kpi.targetOk": "{v} above",
    "adm.ecost.kpi.incompleteSub": "orders with a cost at 0",
    "adm.ecost.gl.title": "What each cost includes",
    "adm.ecost.gl.sub": "Every concept in one line, in the order it is taken out of the money paid.",
    "adm.ecost.gl.step": "Step {n}",
    "adm.ecost.gl.deduction.name": "Deductions",
    "adm.ecost.gl.deduction.def": "Money the customer paid that was never yours: it leaves before anything is counted.",
    "adm.ecost.gl.deduction.items": "Shipping · Taxes · Stripe (card) fee",
    "adm.ecost.gl.material.name": "Materials",
    "adm.ecost.gl.material.def": "What you buy to make that order, at supplier price (a fixed amount per piece).",
    "adm.ecost.gl.material.items": "Frame · Lenses · Treatments (anti-reflective, photochromic) · Case",
    "adm.ecost.gl.percent.name": "% items",
    "adm.ecost.gl.percent.def": "Business expenses spread as a percentage of each sale's net.",
    "adm.ecost.gl.percent.items": "Lab · Packaging · Maintenance · Customer service · Rent · Reserve",
    "adm.ecost.gl.seller.name": "Seller",
    "adm.ecost.gl.seller.def": "The commission of whoever brought the sale: their % of the order's net.",
    "adm.ecost.gl.seller.items": "Seller commission (from their profile)",
    "adm.ecost.gl.manual.name": "Manual adjustment",
    "adm.ecost.gl.manual.def": "An extra cost you typed by hand on that order's sheet.",
    "adm.ecost.gl.manual.items": "Extra courier · Replacement · Any one-off expense",
    "adm.ecost.gl.profit.name": "Profit",
    "adm.ecost.gl.profit.def": "What is left for the owner after all of the above. The target is the % of net you want to keep.",
    "adm.ecost.gl.profit.items": "Actual profit · Target profit (e.g. 30% of net)",
    "adm.ecost.split.detail": "Split detail",
    "adm.ecost.split.detailSub": "{n} concepts",
    "adm.ecost.col.group": "Group",
    "adm.ecost.col.concept": "Concept",
    "adm.ecost.col.amount": "Amount",
    "adm.ecost.col.pct": "%",
    "adm.ecost.sellers.title": "Sales by seller",
    "adm.ecost.sellers.hint": "Total sold by each seller in the period and which network each sale came through. Click a seller: their panel.",
    "adm.ecost.sellers.open": "Open {name}'s panel",
    "adm.ecost.sellers.none": "No sales with a seller in this period.",
    "adm.ecost.sellers.unassigned": "{n} without seller · {v}",
    "adm.ecost.sellers.orders": "{n} orders",
    "adm.ecost.sellers.via": "{n} via {net}",
    "adm.ecost.sellers.channels": "Sales by network",
    "adm.ecost.cmp.title": "Sales vs cost by day",
    "adm.ecost.cmp.hint": "Each day, what was sold next to what it cost; the % over each pair is the day's margin (profit ÷ sales).",
    "adm.ecost.cmp.name": "sales-vs-cost",
    "adm.ecost.cmp.sheet": "By day",
    "adm.chart.sales": "Sales",
    "adm.chart.cost": "Cost",
    "adm.chart.profit": "Profit",
    "adm.chart.margin": "Margin",
    "adm.chart.ariaCompare": "Bar chart: {sales} and {cost} per day, {n} days",
    "adm.ecost.recent.net": "net {v}",
    "adm.help.group.cost": "Costs and margin",
  },
};

/* Guías de ayuda (HelpTip): title, short, what, how[], why, example, pitfalls[].
   Las cifras del ejemplo son siempre las mismas (un pedido de $300) para que
   las guías se lean como capítulos de la misma historia. */
const HELP_ES = {
  "cost.paid": {
    title: "Pagado",
    short: "Todo el dinero que los clientes pagaron en el período, tal cual entró: con envío, impuestos y comisión de tarjeta incluidos.",
    what: "Es la suma de lo que pagó cada cliente por sus pedidos del período (solo pedidos pagados; los cancelados o reembolsados no cuentan). Es el número más grande de la pantalla porque todavía no se ha descontado nada: incluye el envío que cobraste, los impuestos y lo que la tarjeta se queda.",
    how: [
      "Se toma cada pedido pagado del período y la tienda elegida.",
      "Se suma el total que pagó el cliente (producto + envío + impuestos).",
      "Fórmula: Pagado = Σ total pagado de cada pedido.",
    ],
    why: "Es el punto de partida de todo el reparto: cada otra cifra de esta pantalla es «Pagado menos algo». Si sube pero la ganancia no, el problema está en los costos, no en las ventas.",
    example: "Un cliente paga $300 por unas gafas: $260 de producto, $25 de envío y $15 de impuestos. Pagado = $300. Si en el mes hubo 10 pedidos así, Pagado = $3,000.",
    pitfalls: [
      "Pensar que es «lo que gané»: el envío, los impuestos y Stripe van dentro y no son tuyos.",
      "Compararlo con el costo directamente: el costo se calcula sobre el Neto, no sobre el Pagado.",
    ],
  },
  "cost.net": {
    title: "Neto",
    short: "Lo pagado menos lo que nunca fue tuyo: envío, impuestos y comisión de Stripe. Sobre esta cifra se calculan los porcentajes.",
    what: "El neto es el dinero que de verdad entra en la óptica. Del total pagado se quitan primero las «deducciones»: el envío (va a la mensajería), los impuestos (van al estado) y la comisión de la tarjeta (va a Stripe). Lo que queda es la base sobre la que se reparten las partidas %, la comisión del vendedor y la ganancia objetivo.",
    how: [
      "Se parte del total pagado del pedido.",
      "Se resta el envío cobrado, los impuestos y la comisión de Stripe (porcentaje + fijo de la regla «Comisiones de pago»).",
      "Fórmula: Neto = Pagado − envío − impuestos − Stripe.",
    ],
    why: "Si calculas la renta, la comisión del vendedor o tu ganancia sobre el Pagado, estás repartiendo dinero que no tienes. Todos los porcentajes de esta pantalla usan el Neto justamente para evitarlo.",
    example: "Pagado $300 − envío $25 − impuestos $15 − Stripe ($300 × 2.9 % + $0.30 = $9.00) = Neto $251.",
    pitfalls: [
      "Dejar la comisión de Stripe a 0 en «Comisiones de pago»: el neto sale inflado y todas las partidas % se cobran de más.",
      "Que un pedido traiga el envío a 0 porque lo regalaste: el costo real de enviarlo entonces hay que ponerlo como material o ajuste manual.",
    ],
  },
  "cost.cost": {
    title: "Costo",
    short: "Todo lo que te cuesta cumplir los pedidos: materiales + partidas % + comisión del vendedor (+ ajustes manuales). No incluye las deducciones.",
    what: "El costo operativo es la suma de tres bloques: los materiales (montura, lentes, tratamientos, estuche, a precio de proveedor), las partidas por porcentaje (laboratorio, empaque, renta, atención… cada una como un % del neto) y la comisión del vendedor que trajo la venta. Si en algún pedido anotaste un gasto a mano, también entra aquí.",
    how: [
      "Materiales: se busca la ficha de costo de cada pieza del pedido (marca de la montura, tipo de lente, tratamientos) y se suma su importe fijo.",
      "Partidas %: cada regla de Distribución se aplica al neto del pedido (p. ej. laboratorio 8 % × neto).",
      "Vendedor: el % de comisión de su ficha × neto del pedido.",
      "Fórmula: Costo = materiales + Σ(partida % × Neto) + comisión + ajustes.",
    ],
    why: "Es la cifra que puedes mover: negociar la montura con el proveedor, ajustar un % o la comisión cambia el costo al instante. Las deducciones, en cambio, no dependen de ti.",
    example: "Pedido con Neto $251: montura $40 + lentes $35 + antirreflejo $10 = materiales $85. Partidas %: laboratorio 8 % ($20.08) + empaque 2 % ($5.02) + renta 10 % ($25.10) = $50.20. Vendedor 5 % = $12.55. Costo = $85 + $50.20 + $12.55 = $147.75.",
    pitfalls: [
      "Una montura sin ficha de costo entra a $0 y el costo parece menor de lo que es: mira la tarjeta «Incompletas».",
      "Meter el envío como material cuando ya se dedujo del neto: se descontaría dos veces.",
    ],
  },
  "cost.profit": {
    title: "Ganancia",
    short: "Lo que queda para el dueño: Pagado − deducciones − costo. El % de al lado es sobre el Neto.",
    what: "La ganancia es el dinero que se queda en la óptica una vez pagado todo: la mensajería, el estado, la tarjeta, los proveedores, la parte de gastos fijos y el vendedor. Se muestra en dólares y como porcentaje del neto, que es como se define el objetivo.",
    how: [
      "Se calcula el Neto (Pagado − deducciones).",
      "Se resta el Costo (materiales + partidas % + vendedor + ajustes).",
      "Fórmula: Ganancia = Neto − Costo.  Ganancia % = Ganancia ÷ Neto × 100.",
      "Verde si cumple el objetivo; rojo si queda por debajo.",
    ],
    why: "Es el único número que de verdad responde «¿me conviene este negocio?». Vender mucho con ganancia baja es trabajar para el proveedor y la tarjeta.",
    example: "Neto $251 − Costo $147.75 = Ganancia $103.25, que es el 41 % del neto. Con un objetivo del 30 % ($75.30), este pedido va $27.95 por encima.",
    pitfalls: [
      "Leer el % como «sobre lo pagado»: $103.25 son el 34 % del Pagado pero el 41 % del Neto; el objetivo se compara con el segundo.",
      "Una ganancia alta con fichas incompletas es ficticia: primero completa los costos.",
    ],
  },
  "cost.target": {
    title: "Objetivo",
    short: "El % del neto que quieres conservar como ganancia (30 % por defecto) convertido a dólares, y cuánto falta o sobra para llegar.",
    what: "La ganancia objetivo es una regla que tú defines en Distribución %: «quiero quedarme con el 30 % del neto de cada venta». Esta tarjeta la convierte a dinero para el período (objetivo × neto) y la compara con la ganancia real. No es un costo: no se descuenta de nada, solo marca la raya que quieres superar.",
    how: [
      "Define el % en Costos → Distribución % (regla «Ganancia objetivo»).",
      "Fórmula: Objetivo $ = Neto × objetivo %.",
      "Diferencia = Ganancia − Objetivo $: positiva (sobra) en verde, negativa (falta) en rojo.",
      "En la barra «Reparto del ingreso», la marca ◆ señala dónde debería empezar la ganancia para cumplirlo.",
    ],
    why: "Sin objetivo no hay semáforo: cualquier ganancia parece buena. Con él, cada pedido y cada día te dicen si vas bien antes de cerrar el mes.",
    example: "Neto $251 × 30 % = objetivo $75.30. Ganancia real $103.25 → sobran $27.95. Si la ganancia hubiera sido $60, faltarían $15.30 y la tarjeta se vería en rojo.",
    pitfalls: [
      "Fijar el objetivo sobre el Pagado mentalmente y sobre el Neto en la regla: la raya quedará más baja de lo que crees.",
      "Subir el objetivo sin subir precios ni bajar costos: solo cambia el color, no el dinero.",
    ],
  },
  "cost.incomplete": {
    title: "Incompletas",
    short: "Pedidos a los que les falta algún costo (p. ej. una montura sin precio de proveedor). Mientras haya, la ganancia está inflada.",
    what: "Cada pedido tiene una ficha de costo que se arma sola con las reglas (fichas por marca, lente, tratamientos, porcentajes). Cuando una pieza del pedido no encuentra regla, entra a $0 y el pedido se cuenta como «incompleto». Esta tarjeta dice cuántos hay en el período.",
    how: [
      "Clic en la tarjeta: abre Fichas de costo con los pedidos que faltan.",
      "Pon el precio de proveedor de la marca o del lente que falta: todos los pedidos con esa pieza se completan a la vez.",
      "Si es un caso único, edita la ficha del pedido y anota el costo a mano.",
    ],
    why: "Un costo en 0 no es un costo bajo: es un costo desconocido. Con fichas incompletas, la ganancia y el margen de esta pantalla son optimistas y no sirven para decidir.",
    example: "Vendiste 3 monturas de una marca nueva sin ficha: los 3 pedidos salen con materiales $35 en vez de $75 y la ganancia del mes aparece $120 más alta de lo real.",
    pitfalls: [
      "Ignorar la alerta porque «son pocos»: tres pedidos de $300 son el 10 % de un mes de $9,000.",
      "Completar la ficha del pedido a mano cuando lo que falta es la regla de la marca: el siguiente pedido volverá a salir incompleto.",
    ],
  },
  "cost.split": {
    title: "Reparto del ingreso",
    short: "De cada dólar pagado: qué parte se va en deducciones, materiales, partidas %, vendedor y qué parte queda como ganancia.",
    what: "La barra reparte el total pagado del período en bloques de color, en el orden en que se descuentan: deducciones (gris), materiales (azul oscuro), partidas % (dorado), vendedor (morado), ajustes manuales y, al final, la ganancia (verde). La marca ◆ señala dónde debería empezar la ganancia para cumplir el objetivo. Debajo, «Detalle del reparto» abre la lista concepto por concepto con su importe y su % del pagado.",
    how: [
      "Pasa el ratón por un bloque para ver el concepto, el importe y el %.",
      "Clic en un bloque o en una pastilla: abre la pantalla donde se edita (fichas, distribución o vendedores).",
      "Abre «Detalle del reparto» para ver los ~25 conceptos ordenados por importe.",
    ],
    why: "Es la foto más honesta del negocio: si el verde es pequeño o no llega a la marca ◆, la pantalla te dice en qué color se fue el dinero.",
    example: "Pagado $300: deducciones $49 (16 %), materiales $85 (28 %), partidas % $50.20 (17 %), vendedor $12.55 (4 %), ganancia $103.25 (34 %). La marca ◆ queda en $75.30 (30 % del neto): la ganancia la supera.",
    pitfalls: [
      "Comparar el % de la ganancia aquí (sobre el Pagado) con el objetivo (sobre el Neto): son bases distintas.",
      "Si aparece un bloque rojo «−$» es que el costo supera el ingreso: hay pérdida en el período.",
    ],
  },
  "cost.deductions": {
    title: "Deducciones",
    short: "Envío, impuestos y comisión de Stripe: dinero que pasó por tu cuenta pero no es tuyo. Se restan antes que cualquier costo.",
    what: "Son tres conceptos que el cliente paga dentro del total y que tú simplemente entregas a otro: el envío a la mensajería, los impuestos al estado y la comisión de la tarjeta a Stripe. No son costos del negocio (no dependen de cómo trabajes) y por eso van aparte y se descuentan primero, para llegar al Neto.",
    how: [
      "Envío e impuestos: se toman tal cual del pedido (lo que se le cobró al cliente).",
      "Stripe: la regla «Comisiones de pago» (p. ej. 2.9 % + $0.30 por cobro) aplicada al total pagado.",
      "Fórmula: Deducciones = envío + impuestos + Stripe.",
    ],
    why: "Separarlas evita el error más común de una tienda pequeña: calcular comisiones y ganancias sobre dinero que ya está comprometido.",
    example: "Pedido de $300: envío $25 + impuestos $15 + Stripe $9.00 = deducciones $49. Neto = $251.",
    pitfalls: [
      "Olvidar el fijo de Stripe ($0.30): en pedidos pequeños pesa más que el %.",
      "Contar el envío como ingreso: si cobras $25 y pagas $25, no ganaste nada ahí.",
    ],
  },
  "cost.materials": {
    title: "Materiales",
    short: "Montura, lentes, tratamientos y estuche a precio de proveedor: un importe fijo por pieza, definido en Fichas de costo.",
    what: "Los materiales son las piezas físicas que compras para ese pedido. Cada una tiene una ficha de costo: la montura por marca (o por modelo si tiene precio especial), el lente por diseño y material, los tratamientos (antirreflejo, fotocromático) y el estuche. Son importes fijos: no cambian con el precio de venta.",
    how: [
      "Costos → Fichas de costo: pon el precio mayorista por marca de montura, por tipo de lente y por tratamiento.",
      "Cada pedido suma automáticamente las fichas de sus piezas.",
      "Fórmula: Materiales = montura + lentes + tratamientos + estuche (+ fijos por pedido).",
    ],
    why: "Es el costo que más pesa y el más negociable: un dólar menos en la montura es un dólar más de ganancia en cada venta de esa marca.",
    example: "Montura DiCaprio $40 + lente monofocal CR-39 $35 + antirreflejo $10 = materiales $85.",
    pitfalls: [
      "Dejar una marca sin ficha: entra a $0 y el pedido queda «incompleto».",
      "Poner el precio de venta en vez del de proveedor: el costo se dispara y la ganancia parece negativa.",
    ],
  },
  "cost.percent": {
    title: "Partidas %",
    short: "Gastos fijos del negocio (laboratorio, empaque, renta, atención…) repartidos como un % del neto de cada venta.",
    what: "La renta, el laboratorio, el empaque, la atención al cliente o una reserva para imprevistos no se pagan «por pedido», pero cada pedido debe cubrir su parte. Las partidas % hacen justo eso: cada una es un porcentaje del neto que se aparta como costo. Se definen en Distribución %.",
    how: [
      "Costos → Distribución %: añade una partida por concepto con su %.",
      "Cada pedido aplica cada % a su Neto.",
      "Fórmula: partida = Neto × % ; Partidas % = Σ partidas.",
      "La suma de los % más el objetivo de ganancia no debería pasar del 100 %.",
    ],
    why: "Sin estas partidas, una venta parece ganar $100 y a fin de mes la renta se come la mitad. Con ellas, la ganancia de cada pedido ya es «después de la renta».",
    example: "Neto $251: laboratorio 8 % = $20.08, empaque 2 % = $5.02, renta 10 % = $25.10. Partidas % = $50.20.",
    pitfalls: [
      "Calcular un % sobre el Pagado: se aparta de más (sobre dinero que ya era deducción).",
      "Sumar partidas hasta superar el 100 % junto al objetivo: ningún pedido podrá cumplirlo.",
    ],
  },
  "cost.commission": {
    title: "Vendedor",
    short: "La comisión de quien trajo la venta: su % (de su ficha de vendedor) sobre el neto del pedido.",
    what: "Cada vendedor tiene un código y un % de comisión. Cuando una venta llega con su código (enlace, red social o venta en tienda), ese % del neto se aparta como costo y se le paga a él. Un pedido sin vendedor no genera comisión.",
    how: [
      "Vendedores → ficha: fija el % de comisión.",
      "Fórmula: Comisión = Neto × % del vendedor.",
      "En «Ventas por vendedor», clic en un nombre para ver su panel con sus ventas y redes.",
    ],
    why: "Es un costo que sube con las ventas: conviene tenerlo visible para que una campaña con comisión alta no se coma el margen.",
    example: "Neto $251 × 5 % = comisión $12.55 para el vendedor con código DAN.",
    pitfalls: [
      "Pagar la comisión sobre el Pagado: el vendedor cobraría sobre el envío y los impuestos.",
      "Ventas sin código («sin vendedor»): nadie cobra, pero tampoco sabes quién las trajo.",
    ],
  },
  "cost.marginChart": {
    title: "Ventas vs costo por día",
    short: "Cada día, dos barras: lo vendido (acento) y lo que costó (gris). El % encima es el margen del día: cuánto de lo vendido se quedó.",
    what: "La gráfica pone lado a lado, para cada día del período, el total vendido y su costo total (deducciones + materiales + partidas % + vendedor). La distancia entre las dos barras es la ganancia del día, y el número sobre cada par es el margen: ganancia ÷ ventas. Un día con la barra gris más alta que la de acento perdió dinero y su % sale en rojo.",
    how: [
      "Pasa el ratón por un día: ventas, costo, ganancia y margen de ese día.",
      "Si hay muchos días, los % se muestran salteados; al pasar el ratón aparece el del día.",
      "Exporta la serie (CSV, Excel o PDF) desde los iconos de la tarjeta.",
    ],
    why: "Dos cifras juntas cuentan más que dos gráficas separadas: ves al instante si un día de muchas ventas fue también un día de buen margen o solo de mucho trabajo.",
    example: "Lunes: ventas $900, costo $560 → ganancia $340, margen 38 %. Martes: ventas $300, costo $320 → −$20, margen −7 % (en rojo): probablemente un pedido con montura cara o una comisión alta.",
    pitfalls: [
      "Leer el % como «del neto»: aquí es sobre lo vendido ese día, para que se compare con la barra.",
      "Un día sin barra gris no es un día sin costo: puede ser un pedido con la ficha incompleta.",
    ],
  },
};

const HELP_EN = {
  "cost.paid": {
    title: "Paid",
    short: "All the money customers paid in the period, as it came in: shipping, taxes and card fee included.",
    what: "The sum of what each customer paid for their orders in the period (paid orders only; canceled or refunded ones do not count). It is the biggest number on the screen because nothing has been taken out yet: it includes the shipping you charged, the taxes and what the card keeps.",
    how: [
      "Every paid order of the period and the chosen store is taken.",
      "The total the customer paid is added (product + shipping + taxes).",
      "Formula: Paid = Σ total paid of each order.",
    ],
    why: "It is the starting point of the whole split: every other figure on this screen is \"Paid minus something\". If it rises and the profit does not, the problem is in the costs, not in the sales.",
    example: "A customer pays $300 for glasses: $260 product, $25 shipping and $15 taxes. Paid = $300. With 10 such orders in the month, Paid = $3,000.",
    pitfalls: [
      "Reading it as \"what I earned\": shipping, taxes and Stripe are inside and are not yours.",
      "Comparing it directly with the cost: the cost is computed over the Net, not over Paid.",
    ],
  },
  "cost.net": {
    title: "Net",
    short: "Paid minus what was never yours: shipping, taxes and the Stripe fee. Percentages are computed over this figure.",
    what: "The net is the money that really enters the store. From the total paid, the \"deductions\" leave first: shipping (goes to the courier), taxes (go to the state) and the card fee (goes to Stripe). What is left is the base over which % items, the seller commission and the target profit are spread.",
    how: [
      "Start from the order's total paid.",
      "Subtract the shipping charged, the taxes and the Stripe fee (percentage + fixed from the \"Payment fees\" rule).",
      "Formula: Net = Paid − shipping − taxes − Stripe.",
    ],
    why: "If you compute rent, the seller commission or your profit over Paid, you are splitting money you do not have. Every percentage on this screen uses the Net precisely to avoid that.",
    example: "Paid $300 − shipping $25 − taxes $15 − Stripe ($300 × 2.9% + $0.30 = $9.00) = Net $251.",
    pitfalls: [
      "Leaving the Stripe fee at 0 in \"Payment fees\": the net is inflated and every % item is overcharged.",
      "An order with shipping at 0 because you gave it away: the real cost of shipping must then go in as a material or a manual adjustment.",
    ],
  },
  "cost.cost": {
    title: "Cost",
    short: "Everything it costs you to fulfil the orders: materials + % items + seller commission (+ manual adjustments). Deductions are not included.",
    what: "The operating cost is the sum of three blocks: materials (frame, lenses, treatments, case, at supplier price), the percentage items (lab, packaging, rent, service… each as a % of net) and the commission of the seller who brought the sale. If you typed an expense by hand on some order, it is included too.",
    how: [
      "Materials: the cost sheet of each piece of the order is looked up (frame brand, lens type, treatments) and its fixed amount is added.",
      "% items: each Allocation rule is applied to the order's net (e.g. lab 8% × net).",
      "Seller: their commission % × the order's net.",
      "Formula: Cost = materials + Σ(% item × Net) + commission + adjustments.",
    ],
    why: "It is the figure you can move: negotiating the frame with the supplier, adjusting a % or the commission changes the cost at once. Deductions, on the other hand, are not up to you.",
    example: "Order with Net $251: frame $40 + lenses $35 + anti-reflective $10 = materials $85. % items: lab 8% ($20.08) + packaging 2% ($5.02) + rent 10% ($25.10) = $50.20. Seller 5% = $12.55. Cost = $85 + $50.20 + $12.55 = $147.75.",
    pitfalls: [
      "A frame without a cost sheet enters at $0 and the cost looks lower than it is: check the \"Incomplete\" card.",
      "Entering shipping as a material when it was already deducted from the net: it would be taken out twice.",
    ],
  },
  "cost.profit": {
    title: "Profit",
    short: "What is left for the owner: Paid − deductions − cost. The % next to it is over the Net.",
    what: "The profit is the money that stays in the store once everything is paid: the courier, the state, the card, the suppliers, the share of fixed expenses and the seller. It is shown in dollars and as a percentage of net, which is how the target is defined.",
    how: [
      "Compute the Net (Paid − deductions).",
      "Subtract the Cost (materials + % items + seller + adjustments).",
      "Formula: Profit = Net − Cost.  Profit % = Profit ÷ Net × 100.",
      "Green when it meets the target; red when it falls below.",
    ],
    why: "It is the only number that truly answers \"is this business worth it?\". Selling a lot with low profit is working for the supplier and the card.",
    example: "Net $251 − Cost $147.75 = Profit $103.25, which is 41% of net. With a 30% target ($75.30), this order is $27.95 above.",
    pitfalls: [
      "Reading the % as \"of paid\": $103.25 is 34% of Paid but 41% of Net; the target is compared with the latter.",
      "A high profit with incomplete sheets is fictional: complete the costs first.",
    ],
  },
  "cost.target": {
    title: "Target",
    short: "The % of net you want to keep as profit (30% by default) turned into dollars, and how much is missing or left over.",
    what: "The target profit is a rule you define in Allocation %: \"I want to keep 30% of the net of each sale\". This card turns it into money for the period (target × net) and compares it with the actual profit. It is not a cost: it is not deducted from anything, it only draws the line you want to clear.",
    how: [
      "Set the % in Costs → Allocation % (\"Target profit\" rule).",
      "Formula: Target $ = Net × target %.",
      "Gap = Profit − Target $: positive (above) in green, negative (short) in red.",
      "On the \"Revenue split\" bar, the ◆ mark shows where profit should start to meet it.",
    ],
    why: "Without a target there is no traffic light: any profit looks fine. With it, every order and every day tells you whether you are on track before the month closes.",
    example: "Net $251 × 30% = target $75.30. Actual profit $103.25 → $27.95 above. Had the profit been $60, it would be $15.30 short and the card would show red.",
    pitfalls: [
      "Thinking of the target over Paid while the rule is over Net: the line will sit lower than you believe.",
      "Raising the target without raising prices or cutting costs: only the colour changes, not the money.",
    ],
  },
  "cost.incomplete": {
    title: "Incomplete",
    short: "Orders missing some cost (e.g. a frame without a supplier price). While there are any, the profit is inflated.",
    what: "Each order has a cost sheet built automatically from the rules (sheets per brand, lens, treatments, percentages). When a piece of the order finds no rule, it enters at $0 and the order counts as \"incomplete\". This card says how many there are in the period.",
    how: [
      "Click the card: opens Cost sheets with the orders that are missing.",
      "Enter the supplier price of the missing brand or lens: every order with that piece is completed at once.",
      "If it is a one-off, edit the order's sheet and type the cost by hand.",
    ],
    why: "A cost at 0 is not a low cost: it is an unknown cost. With incomplete sheets, the profit and margin on this screen are optimistic and no good for deciding.",
    example: "You sold 3 frames of a new brand without a sheet: the 3 orders come out with materials $35 instead of $75 and the month's profit appears $120 higher than real.",
    pitfalls: [
      "Ignoring the alert because \"it is only a few\": three $300 orders are 10% of a $9,000 month.",
      "Completing the order's sheet by hand when what is missing is the brand rule: the next order will come out incomplete again.",
    ],
  },
  "cost.split": {
    title: "Revenue split",
    short: "Of every dollar paid: which part goes to deductions, materials, % items, seller and which part stays as profit.",
    what: "The bar splits the period's total paid into coloured blocks, in the order they are taken out: deductions (grey), materials (dark blue), % items (gold), seller (purple), manual adjustments and, at the end, the profit (green). The ◆ mark shows where profit should start to meet the target. Below, \"Split detail\" opens the concept-by-concept list with its amount and % of paid.",
    how: [
      "Hover a block to see the concept, the amount and the %.",
      "Click a block or a pill: opens the screen where it is edited (sheets, allocation or sellers).",
      "Open \"Split detail\" to see the ~25 concepts sorted by amount.",
    ],
    why: "It is the most honest picture of the business: if the green is small or does not reach the ◆ mark, the screen tells you which colour the money went to.",
    example: "Paid $300: deductions $49 (16%), materials $85 (28%), % items $50.20 (17%), seller $12.55 (4%), profit $103.25 (34%). The ◆ mark sits at $75.30 (30% of net): the profit clears it.",
    pitfalls: [
      "Comparing the profit % here (over Paid) with the target (over Net): different bases.",
      "A red \"−$\" block means the cost exceeds the revenue: the period made a loss.",
    ],
  },
  "cost.deductions": {
    title: "Deductions",
    short: "Shipping, taxes and the Stripe fee: money that went through your account but is not yours. Subtracted before any cost.",
    what: "Three concepts the customer pays inside the total and that you simply hand over to someone else: shipping to the courier, taxes to the state and the card fee to Stripe. They are not business costs (they do not depend on how you work), so they sit apart and are taken out first, to reach the Net.",
    how: [
      "Shipping and taxes: taken as they are from the order (what the customer was charged).",
      "Stripe: the \"Payment fees\" rule (e.g. 2.9% + $0.30 per charge) applied to the total paid.",
      "Formula: Deductions = shipping + taxes + Stripe.",
    ],
    why: "Keeping them apart avoids the most common mistake of a small shop: computing commissions and profit over money that is already committed.",
    example: "$300 order: shipping $25 + taxes $15 + Stripe $9.00 = deductions $49. Net = $251.",
    pitfalls: [
      "Forgetting the Stripe fixed part ($0.30): on small orders it weighs more than the %.",
      "Counting shipping as revenue: if you charge $25 and pay $25, you earned nothing there.",
    ],
  },
  "cost.materials": {
    title: "Materials",
    short: "Frame, lenses, treatments and case at supplier price: a fixed amount per piece, defined in Cost sheets.",
    what: "Materials are the physical pieces you buy for that order. Each has a cost sheet: the frame per brand (or per model if it has a special price), the lens per design and material, the treatments (anti-reflective, photochromic) and the case. They are fixed amounts: they do not change with the selling price.",
    how: [
      "Costs → Cost sheets: enter the wholesale price per frame brand, per lens type and per treatment.",
      "Each order automatically adds the sheets of its pieces.",
      "Formula: Materials = frame + lenses + treatments + case (+ fixed per order).",
    ],
    why: "It is the heaviest cost and the most negotiable: one dollar less on the frame is one dollar more profit on every sale of that brand.",
    example: "DiCaprio frame $40 + single-vision CR-39 lens $35 + anti-reflective $10 = materials $85.",
    pitfalls: [
      "Leaving a brand without a sheet: it enters at $0 and the order is \"incomplete\".",
      "Entering the selling price instead of the supplier price: the cost skyrockets and the profit looks negative.",
    ],
  },
  "cost.percent": {
    title: "% items",
    short: "Fixed business expenses (lab, packaging, rent, service…) spread as a % of the net of each sale.",
    what: "Rent, the lab, packaging, customer service or a reserve for surprises are not paid \"per order\", but each order must cover its share. The % items do exactly that: each is a percentage of the net set aside as a cost. They are defined in Allocation %.",
    how: [
      "Costs → Allocation %: add one item per concept with its %.",
      "Each order applies every % to its Net.",
      "Formula: item = Net × % ; % items = Σ items.",
      "The sum of the % plus the profit target should not exceed 100%.",
    ],
    why: "Without these items a sale seems to earn $100 and at month end the rent eats half. With them, each order's profit is already \"after rent\".",
    example: "Net $251: lab 8% = $20.08, packaging 2% = $5.02, rent 10% = $25.10. % items = $50.20.",
    pitfalls: [
      "Computing a % over Paid: too much is set aside (over money that was already a deduction).",
      "Adding items until they exceed 100% together with the target: no order will be able to meet it.",
    ],
  },
  "cost.commission": {
    title: "Seller",
    short: "The commission of whoever brought the sale: their % (from their seller profile) over the order's net.",
    what: "Each seller has a code and a commission %. When a sale arrives with their code (link, social network or in-store sale), that % of net is set aside as a cost and paid to them. An order without a seller generates no commission.",
    how: [
      "Sellers → profile: set the commission %.",
      "Formula: Commission = Net × seller %.",
      "In \"Sales by seller\", click a name to see their panel with their sales and networks.",
    ],
    why: "It is a cost that grows with sales: keep it visible so a campaign with a high commission does not eat the margin.",
    example: "Net $251 × 5% = $12.55 commission for the seller with code DAN.",
    pitfalls: [
      "Paying the commission over Paid: the seller would earn over shipping and taxes.",
      "Sales without a code (\"without seller\"): nobody gets paid, but you also do not know who brought them.",
    ],
  },
  "cost.marginChart": {
    title: "Sales vs cost by day",
    short: "Each day, two bars: what was sold (accent) and what it cost (grey). The % above is the day's margin: how much of what was sold stayed.",
    what: "The chart puts side by side, for each day of the period, the total sold and its total cost (deductions + materials + % items + seller). The distance between the two bars is the day's profit, and the number above each pair is the margin: profit ÷ sales. A day whose grey bar is taller than the accent one lost money and its % shows in red.",
    how: [
      "Hover a day: sales, cost, profit and margin of that day.",
      "With many days the % labels thin out; hovering shows the one for that day.",
      "Export the series (CSV, Excel or PDF) from the card's icons.",
    ],
    why: "Two figures together say more than two separate charts: you see at once whether a day of many sales was also a day of good margin or just of a lot of work.",
    example: "Monday: sales $900, cost $560 → profit $340, margin 38%. Tuesday: sales $300, cost $320 → −$20, margin −7% (in red): probably an order with an expensive frame or a high commission.",
    pitfalls: [
      "Reading the % as \"of net\": here it is over what was sold that day, so it compares with the bar.",
      "A day without a grey bar is not a day without cost: it may be an order with an incomplete sheet.",
    ],
  },
};

/** Aplana {tema: {campo: texto | [líneas]}} a claves `adm.help.<tema>.<campo>` (mismo contrato que help.js). */
function flatten(topics) {
  const out = {};
  for (const [topic, fields] of Object.entries(topics)) {
    for (const [field, value] of Object.entries(fields)) {
      out[`adm.help.${topic}.${field}`] = Array.isArray(value) ? value.join("\n") : value;
    }
  }
  return out;
}

export default {
  es: { ...UI.es, ...flatten(HELP_ES) },
  en: { ...UI.en, ...flatten(HELP_EN) },
};
