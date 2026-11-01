# Contabilidad y finanzas del panel

Documento de referencia de **toda cifra de dinero** que el panel muestra: su
fórmula exacta, de qué tabla y columna sale, qué incluye, qué excluye, cómo
redondea, a qué período pertenece y quién puede verla.

Auditoría de contabilidad del 1-nov-2026. Lo que aquí se afirma está fijado por
pruebas: `apps/backend/tests/accounting-audit.test.ts` (una prueba por fórmula y
por defecto corregido) y `apps/backend/tests/accounting-reconciliation.test.ts`
(un mes de una tienda leído por las cinco pantallas, con las identidades que
deben cumplirse). Si alguien cambia una fórmula, esas pruebas fallan.

---

## 0. Reglas que valen para todo

### Dinero: centavos enteros

En el servidor **todo importe es un entero de centavos**. Nunca hay un `float`
de dólares en una suma: `total_cents`, `tax_cents`, `fee_cents`, `amount_cents`.
La división por 100 ocurre **una sola vez**, al final, cuando la cifra sale
hacia el panel (`figures()` en `sales-insights.ts`, `toDollars()` en
`store-pnl.ts`). El panel formatea con `money()` (`es-US`: `$1,234.50`).

Excepción deliberada: las **reglas de costo** (`cost_rule.amount`) las escribe
el dueño en dólares y `costing.ts` trabaja en dólares con `round2` dentro de la
ficha de costo. Al salir de la ficha se convierte a centavos con
`Math.round(x * 100)`. Es decir: el costo de un material se redondea al centavo
una vez, en dólares, y después ya no se mueve.

### Redondeo

| Caso | Regla |
|---|---|
| Porcentaje sobre un importe (impuesto, comisión, % de pasarela) | `Math.round(base * pct / 100)` — al centavo más cercano, mitad hacia arriba |
| Reparto de un importe de pedido entre sus líneas | **Resto mayor** (`allocateCents`): las partes suman exactamente el importe |
| Reparto de un costo compartido entre tiendas | **Resto mayor** (`allocateShared`, `store-costs.ts`) |
| Porcentajes mostrados (margen, cuota, % de contribución) | un decimal: `Math.round(x * 1000) / 10` |
| Ticket promedio | al centavo: `Math.round(ventas_centavos / pedidos) / 100` |
| Punto de equilibrio | se calcula con la fracción **sin redondear**, no con el % mostrado |

**Por qué el resto mayor.** Si una venta de dos líneas lleva $1.00 de costo fijo
de laboratorio y las líneas valen 33.33 % / 33.33 % / 33.34 % del neto,
redondear cada parte por separado da 33 + 33 + 33 = 99 ¢: falta un centavo. Con
resto mayor da 33 + 33 + 34 = 100 ¢. Un estado de cuenta que no cuadra por un
centavo es un estado de cuenta que nadie vuelve a creer.

### Períodos y zona horaria

- La zona horaria del inquilino es **una sola** (`tenant().timezone`, por
  defecto `America/Chicago`, variable `GSHEET_TIMEZONE`).
- `sale_fact.sold_date_local` guarda **ya calculado** el día calendario local
  de la venta. Todo filtro de fechas de los tableros compara contra esa columna,
  nunca contra un instante UTC: así no hay corrimiento de un día.
- Donde se parte de un instante (`pos_sale.created_at`,
  `pos_sale_payment.created_at`, `cash_movement.created_at`) se convierte con
  `AT TIME ZONE` en SQL o con `localParts()` en TypeScript, nunca con
  `toISOString().slice(0,10)`.
- Rangos **inclusivos en los dos extremos** (`from` ≤ día ≤ `to`). En SQL el
  límite superior se escribe como `< día_siguiente 00:00` (`nextDay`), que es lo
  mismo sin perder las 23:xx.
- Semanas **ISO**: lunes a domingo, clave `YYYY-Www`, la semana 1 es la que
  contiene el 4 de enero. `2024-12-30` es `2025-W01`; `2027-01-01` es
  `2026-W53`.
- Ventana de pagos del resultado mensual: la consulta SQL abre dos días antes y
  33 después del día 1, y después `sumFeesByStore` conserva solo los pagos cuyo
  **día local** cae en el mes. Así un cobro a las 23:30 del último día no se
  pierde ni se adelanta.

### Qué se excluye de las cifras de dinero (siempre)

| Concepto | Regla |
|---|---|
| Filas borradas | `deleted_at IS NULL` en toda consulta |
| **Ventas anuladas** | `sale_fact.status = 'active'`. Se listan (con su estado) y se cuentan en `voided_count`, pero no entran en ninguna suma. En el estado de cuenta se listan y se excluyen igual. `?voided=1` las incluye explícitamente, y solo para ver |
| **Impuestos** | Nunca son ingreso: el neto es `total − impuesto`. El impuesto es dinero del estado |
| **Envío** | No existe como línea en `sale_fact`, así que nunca entra en ventas ni en neto. En la ficha de costo es una **deducción** (`shipping`), igual que el impuesto |
| **Seguros / cuentas por cobrar** | Se listan por método, nunca como dinero cobrado (`receivable_cents` aparte). No entraron a la caja ni al banco |
| Flotante de apertura de caja | La línea `opening_float` del libro **espeja** `opening_cents`: se imprime, no se vuelve a sumar |
| Líneas automáticas del libro de caja | `sale_payment`, `sale_refund` y `opening_float` espejan los pagos: se listan y se agrupan, nunca se suman encima de los pagos |
| Ganancia objetivo (`profit_target`) | Es una meta, no un costo: nunca se convierte en línea de costo |

### Descuento: antes del impuesto

En el POS (`quoteSale`) y en la proyección (`factFromLine`):

```
lista       = precio de tienda de la montura + precio de los lentes   (sin impuesto)
descuento   = lista − (total − impuesto)
impuesto    = redondeo(total_con_descuento_sin_impuesto × tasa)
total       = total_con_descuento_sin_impuesto + impuesto
```

Es decir: **el descuento se aplica sobre la base sin impuesto y el impuesto se
calcula después**, que es la práctica correcta en venta minorista de EE. UU.
`sale_fact.discount_cents = max(0, list_cents − (total_cents − tax_cents))`
cumple la misma definición, de modo que el POS y los tableros dan el mismo
descuento.

El impuesto de venta se cobra **solo en una montura vendida sin lentes**
(`design_code = "frame-only"`, tasa `store_setting.frame_tax_rate`). Los lentes
con receta son producto médico y no llevan impuesto. Ver la nota de impuestos de
`CLAUDE.md`: Medusa v2 no puede expresar la exención por línea, por eso el POS
la calcula él mismo.

---

## 1. Ejecutivo / Panel de ventas (`lib/sales-insights.ts`)

Fuente: `sale_fact` (una fila por línea vendida) + `pos_sale_payment.fee_cents`
+ `cost_rule` + comisión de la persona.

### Por línea (`lineEconomics`)

```
neto       = total_cents − tax_cents
costo      = materiales (reglas frame_brand | frame_sku | lens_design |
                         lens_material | lens_photo | lens_ar)
             + parte que le toca de los order_fixed del pedido
comisión   = redondeo(neto × % del vendedor / 100)
comisión de cobro (fee):
   venta de tienda → el fee REGISTRADO con los pagos de la venta
                     (pos_sale_payment.fee_cents, suma por sale_id)
   venta web       → % de pasarela sobre lo cobrado + fee fijo
                     (reglas order_percent/payment_fee y payment_fixed)
ganancia   = neto − costo − fee − comisión
margen %   = ganancia / neto × 100        (null si neto = 0)
```

Reglas finas, todas con prueba:

- **El fee y los costos fijos son del pedido, no de la línea.** Se cobran una
  sola vez y se reparten entre las líneas en proporción a su neto, con resto
  mayor, de modo que la suma de las partes es exactamente el importe. Si el
  filtro selecciona *parte* de una venta (un producto, un diseño de lente), esa
  línea solo carga la fracción correspondiente (`coverage`).
- **Venta regalada (100 % de descuento).** Neto 0: el reparto pasa a hacerse por
  número de líneas, no por neto, y no hay división por cero. El costo de los
  materiales sigue gastado, así que la ganancia sale negativa — como debe ser.
- **Montura del cliente** (`category = 'own_frame'`): no hay costo de montura y
  **no** se marca como "costo sin definir". Sí se cobran los lentes y el fijo.
- **Base de la comisión: el neto.** Nunca lo cobrado. Lo mismo hacen
  `store-pnl.ts`, el panel del vendedor (`/admin/sales-analytics/me`) y ahora
  también la pantalla de Vendedores.
- Las reglas **inactivas** no se aplican (lo filtra `computeCostSheet`): una
  línea cuyo material no tiene regla activa queda marcada `missing_cost` y su
  ganancia se lee más alta de lo real. El panel muestra `missing_cost_lines`.
- Se usan las reglas **actuales**, igual que el resultado de la tienda: cambiar
  una regla cambia también el pasado, y una ficha de costo escrita a mano sobre
  un pedido **no** se aplica aquí.

### Totales del período (`figures`)

| Campo | Fórmula |
|---|---|
| `sales` | Σ `total_cents` (lo cobrado, impuesto incluido, después del descuento) |
| `net` | Σ (`total_cents` − `tax_cents`) |
| `tax` | Σ `tax_cents` |
| `cost`, `fee`, `commission`, `profit` | Σ de lo de arriba |
| `margin_pct` | `profit / net × 100`, un decimal; `null` si `net = 0` |
| `count` | **pedidos distintos** (`COUNT(DISTINCT order_id)`), no líneas |
| `units` | Σ `qty` |
| `avg_ticket` | `sales / count`, 0 sin pedidos |
| `share` de una fila | `ventas de la fila / ventas de TODA la dimensión` |

`previous` es el mismo número de días inmediatamente anteriores a `from`
(`previousPeriod`).

**Dimensión `payment_method`:** una venta pagada con dos métodos cuenta en los
dos. Las filas de esa dimensión suman **más** que el total del período; es
correcto y es la única dimensión donde pasa.

### Quién lo ve

`insightAccess` + `redactInsights`, **en el servidor**, nunca ocultando columnas
en el navegador:

- `cost`, `fee`, `profit`, `margin_pct`, `missing_cost`: rol administrador
  (`owner`, `superadmin`) o privilegio `costs.view` / `costs.manage`.
- `commission`: esas mismas personas, y además un `seller` sobre **sus** ventas.
- Un `seller` solo ve sus propias ventas (el filtro se fuerza en
  `analytics-route.ts`); un `supervisor` o `manager`, las de sus tiendas.

---

## 2. Pedidos de la tienda / lista de ventas (`lib/sales-analytics.ts`)

Una fila por pedido, agregando sus `sale_fact`:

| Campo | Fuente |
|---|---|
| `total`, `discount`, `units` | Σ de las líneas del pedido |
| `status` | `sale_fact.status` (`active` / `voided`) |
| `paid` | venta de tienda: `pos_sale.paid_cents`; pedido web: **el total** (se cobra completo al hacerlo) |
| `balance` | venta de tienda: `pos_sale.balance_cents`; web: 0 |
| `net`, `cost`, `fee`, `commission`, `profit`, `margin_pct` | `orderEconomics` → las mismas líneas y reglas del Ejecutivo, redactadas por `attachSaleEconomics` |

`balance_cents` de una venta de tienda es, por construcción,
`total − paid − insurance` (`cleanPayments`, `collectPayment`).

---

## 3. Estado de cuenta (`lib/pos-statement.ts`)

Documento `EST-<códigoTienda>-<AAAAMM>`. Fuente: `pos_sale`,
`pos_sale_payment`, `sale_fact`, `order_line_item`, `customer`.

| Campo | Fórmula |
|---|---|
| `count` | ventas **no** anuladas del período |
| `voided_count` | ventas anuladas (listadas, fuera de todo total) |
| `list_cents` | Σ `pos_sale.list_cents` (o el total si la venta es vieja y no lo tiene) |
| `discount_cents` | Σ `pos_sale.discount_cents` |
| `tax_cents` | Σ `sale_fact.tax_cents` de las líneas de la venta |
| `total_cents` | Σ `pos_sale.total_cents` |
| `paid_cents` | Σ `pos_sale.paid_cents` (dinero del cliente) |
| `insurance_cents` | Σ `pos_sale.insurance_cents` (parte del seguro) |
| `balance_cents` | Σ `pos_sale.balance_cents` = `total − paid − insurance` |
| `by_method` | Σ de los pagos de las ventas vivas, **restando los reembolsos** (`kind = 'refund'`) |
| `by_seller`, `by_day` | Σ `total_cents` por `seller_code` / por día local |
| `settlement` | `pct` × (`total_cents` − `tax_cents`) / 100, solo para tiendas `family` / `partner` / `consignment` con porcentaje |

Identidades que el documento **debe** cumplir (fijadas por prueba):

```
Σ by_seller.total_cents = Σ by_day.total_cents = total_cents
Σ by_method.cents       = paid_cents + insurance_cents
balance_cents           = total_cents − paid_cents − insurance_cents
settlement.base_cents   = total_cents − tax_cents  = neto del Ejecutivo
```

`Σ by_method` incluye al seguro porque en el mostrador el seguro es un método
como cualquier otro, mientras que `paid_cents` es solo dinero del cliente. Esa
diferencia **no es un error**: por eso la identidad suma `insurance_cents`.

Tope: `MAX_STATEMENT_SALES = 2000` ventas por período. Si se pasa, `truncated`
viene en `true` y **tanto el listado como los totales son parciales** (los
totales son la suma de lo listado, que es lo que mantiene cuadrados
`by_seller` y `by_day`). El panel tiene que mostrarlo; un documento contable no
puede imprimir un total corto en silencio.

---

## 4. Caja (`lib/cash.ts`, `lib/cash-report.ts`, `lib/cash-documents.ts`)

### La regla del libro

`cash_movement` es la única verdad de lo que pasó por el cajón mientras una
sesión está abierta:

```
esperado = opening_cents + Σ entradas − Σ salidas      (opening_float excluido)
diferencia = contado − esperado            (positivo = sobra dinero)
```

- Cada pago en efectivo escribe una entrada `sale_payment`; cada reembolso en
  efectivo, una salida `sale_refund`.
- El dinero que se mete o se saca a mano lleva un motivo de `CASH_CATEGORIES`
  (`supplier_payment`, `expense`, `owner_withdrawal`, `bank_deposit`,
  `change_fund`, `refund`, `correction`, `other`).
- `opening_float` espeja `opening_cents` para que el listado impreso esté
  completo; **no se vuelve a sumar**.
- `pos_sale_payment.counts_as_cash` ya no se suma en ningún lado para el arqueo:
  solo dice por qué método entró el dinero.
- **Una sola sesión abierta por tienda.** La apertura es explícita (flotante +
  iniciales) o automática en el primer cobro en efectivo del día, arrastrando el
  conteo de la sesión anterior. El cierre pide conteo e iniciales; una diferencia
  deja la sesión en `pending_approval` hasta que el dueño o un superadmin la
  firme.

### ¿Qué cuenta como efectivo?

Lo decide **la bandera guardada en la fila del pago** (`counts_as_cash`), no la
bandera actual del método. Razón: esa es la bandera que usó la caja para
escribir —o no escribir— la línea del libro, así que es con la que tiene que
cuadrar el conteo. Si el dueño destilda "cuenta como efectivo" en Zelle hoy, el
dinero que ayer entró al cajón sigue estando en el cajón.

### Informe de caja (`buildCashReport`)

| Campo | Fórmula |
|---|---|
| `by_method[].in_cents` | Σ de los pagos positivos del método |
| `by_method[].refund_cents` | Σ de los reembolsos del método, en positivo (un `kind='refund'` es salida con cualquier signo guardado) |
| `by_method[].net_cents` | `in_cents − refund_cents` |
| `totals.payments_cents` | Σ `net_cents` de los métodos **no** por cobrar |
| `totals.cash_payments_cents` | Σ firmada de los pagos que la caja marcó como efectivo |
| `totals.card_cents` | ídem para métodos de tipo `debit` / `credit` / `card` |
| `totals.other_cents` | el resto (Zelle, transferencias, etc.) |
| `totals.receivable_cents` | Σ de los métodos de seguro / por cobrar — **nunca** cobrado |
| `totals.movements_in/out_cents` | solo los movimientos **manuales** (las líneas automáticas espejan los pagos) |
| `totals.cash_net_cents` | `cash_payments + movements_in − movements_out` |
| `totals.fees_cents` | Σ `fee_cents` de los métodos no por cobrar |
| `totals.sessions_diff_cents` | Σ de las diferencias de los cierres del período |
| `series[]` | por día local: cobrado, efectivo que entró, efectivo que salió, neto de efectivo |

Identidades (fijadas por prueba):

```
Σ series.payments_cents  = totals.payments_cents
Σ series.cash_net_cents  = totals.cash_net_cents
Σ series.cash_out_cents  = totals.movements_out_cents
```

Los cierres listados son las sesiones **abiertas** en el período (una caja
abierta de madrugada pertenece al día que se abrió). El listado de movimientos
tiene tope `MAX_MOVEMENTS = 5000`; cuando se pasa, `truncated` viene en `true`
pero **los totales, `by_category` y la serie diaria siguen completos**, porque
se calculan con un agregado SQL aparte sobre todo el período, no sobre el
listado.

### Documento de apertura / cierre (`cashDocumentOf`)

Imprime **exactamente** las cifras de la sesión; no recalcula nada a sus
espaldas. Cumple:

```
apertura + cobros_efectivo − reembolsos + manual_entra − manual_sale = esperado
```

`by_terminal` y `by_seller` reparten el efectivo **neto** de ventas (cobros
menos reembolsos) por punto de venta y por quién lo recibió; el flotante queda
fuera de los dos. `manual` agrupa las líneas a mano por motivo, con sus notas.

---

## 5. Resultado por tienda (`lib/store-pnl.ts`, `lib/store-costs.ts`)

Mes calendario local, **solo ventas de tienda** (`channel = 'pos'`); la web
tiene sus propias fichas de costo en Costos.

```
ventas netas       = Σ (total_cents − tax_cents) de sale_fact activas del mes
costo de mercancía = reglas de costo del dueño, una ficha por venta,
                     solo las líneas de grupo "material" (incluye order_fixed)
comisiones de cobro= Σ pos_sale_payment.fee_cents del mes (día local),
                     EXCLUYENDO los de ventas anuladas
comisiones         = Σ redondeo(neto de la línea × % del vendedor / 100)
                     % = perfil de la persona, y si no tiene, su ficha de vendedor
variables a mano   = partidas "variable" del mes de la tienda
fijos              = partidas "fixed" del mes de la tienda
compartidos        = su parte de las partidas sin tienda

variable_total  = fees + comisiones + variables a mano
contribución    = ventas netas − costo de mercancía − variable_total
contribución %  = contribución / ventas netas × 100          (null si netas = 0)
fijos_total     = fijos + compartidos
resultado       = contribución − fijos_total
punto de equilibrio = fijos_total / (contribución / ventas netas)   (null si la
                      contribución no es positiva)
```

### Frecuencias y vigencia de una partida (`monthlyCharge`)

| Frecuencia | Cargo del mes |
|---|---|
| `monthly` | el importe |
| `quarterly` | `redondeo(importe / 3)` |
| `annual` | `redondeo(importe / 12)` |
| `one_time` | `redondeo(importe / n)` durante `n = amortize_months` meses desde `starts_on`; 0 después |

La vigencia se evalúa **por mes**, no por día: `starts_on` y `ends_on` se
recortan a `YYYY-MM`. Una partida que arranca el 31 de enero cobra enero
completo. Es una convención, no un prorrateo.

### Reparto de un costo compartido (`allocateShared`)

- `{ method: "percent", shares }`: los porcentajes que fijó el dueño (validados
  para que sumen 100).
- `{ method: "sales" }`: en proporción a lo que vendió cada tienda ese mes;
  partes iguales si nadie vendió.
- Siempre con **resto mayor**, así que las partes suman exactamente el cargo.
- Los pesos se toman de **todas las tiendas activas**, no solo de las que se
  están viendo: mirar el resultado de una sola tienda no puede cargarle el
  100 % de la renta de una bodega compartida.

### Liquidación (`settlement`)

Para tiendas que no son propias (`family`, `partner`, `consignment`) con
`settlement_pct`: `store_share = redondeo(neto × pct / 100)`,
`owner_share = neto − store_share`. La misma base que usa el estado de cuenta.

---

## 6. Mapa de inicio (`lib/start-map.ts`)

Períodos, en días calendario locales, con `weekday` de `localParts`:

| Período | Rango | Se compara contra |
|---|---|---|
| `today` | hoy | ayer |
| `yesterday` | ayer | anteayer |
| `this_week` | lunes de esta semana → hoy | `last_week` |
| `last_week` | lunes a domingo pasados | la semana anterior a esa |
| `this_month` | día 1 → hoy | `last_month` |
| `last_month` | mes pasado completo | — (fuera de la ventana leída) |

La ventana de líneas que se lee es "día 1 del mes pasado → hoy", así que nada se
cuenta dos veces a medianoche y nada se cuenta en dos períodos por error.

**Ojo con la comparación de `this_week` y `this_month`:** un período *parcial*
(lunes→hoy, día 1→hoy) se compara con un período *completo* (la semana pasada
entera, el mes pasado entero). Es lo que pidió el dueño, y es la primera
pregunta abierta de la lista final.

| Campo | Fórmula |
|---|---|
| `sales_cents` | Σ `total_cents` de las líneas del período |
| `count` | pedidos distintos |
| `cost_cents` | **costo del Ejecutivo + su fee**, los dos juntos |
| `fee_cents` | solo el fee, para poder conciliar con el Ejecutivo |
| `profit_cents` | el mismo que el Ejecutivo |
| `avg_ticket_cents` | `sales / count` |
| `avg_profit_per_sale_cents` | `profit / count` |
| `on_street` | Σ `pos_sale.balance_cents` de ventas completadas con saldo > 0 |
| `overdue_balances` | las de arriba con `promised_on < hoy` |
| `in_lab` / `to_deliver` | ventas completadas sin entregar, según la etapa del pedido (`shipped` o más = por entregar) |
| `me.commission_month_cents` | la comisión **del propio usuario** en el mes; `null` si el mapa no cubre exactamente sus ventas |

`pending_truncated` avisa cuando hay más de `MAX_OPEN_SALES = 2000` ventas
abiertas y las cifras de pendientes son parciales.

---

## 7. Vendedores (`lib/sellers.ts`)

Fuente distinta a las demás pantallas: la **ventana del tablero de pedidos**
(`scanBoardWindow`, los `MAX_BOARD_SCAN` pedidos más recientes del rango), no
`sale_fact`.

| Campo | Fórmula |
|---|---|
| `revenue` | Σ `order.total` de los pedidos atribuidos (lo que pagó el cliente) |
| `net_revenue` | Σ (`total` − `tax_total` − `shipping_total`) — la base de la comisión |
| `commission` | `net_revenue × commission_pct / 100` |
| `units` | Σ cantidades de las líneas |
| `avg_ticket` | `revenue / orders` |
| `profit` | ganancia bruta de esos pedidos, vía `orderEconomics` (las mismas reglas del Ejecutivo) |
| `share_pct` | `revenue / (todo lo vendido en la ventana, atribuido o no)` |
| `by_source` | por red de origen del referido (`link` cuando no hay) |

Un pedido en estado terminal (cancelado, reembolsado, pago pendiente) **no
genera nada para nadie** (`countsForRevenue`).

---

## Conciliación

Un mes, una tienda, cinco pantallas. `tests/accounting-reconciliation.test.ts`
lo comprueba con este juego de datos: tres ventas vivas ($150.00 con lentes;
$100.00 + $7.00 de impuesto de una montura sola; $120.00 sobre la montura del
cliente pagada con **dos métodos** más $20.00 del seguro y $20.00 a deber) y una
venta **anulada** de $200.00 cobrada en efectivo y devuelta el mismo día.

### Lo que tiene que dar igual

| Identidad | Por qué |
|---|---|
| `Estado de cuenta.total_cents` = `Ejecutivo.sales` = Σ `total` de Pedidos de la tienda | las tres son "lo cobrado" sobre las mismas ventas vivas |
| `Estado de cuenta.total − tax` = `Ejecutivo.net` = `Resultado por tienda.net_sales` = `settlement.base_cents` | el neto es una sola definición: lo cobrado menos el impuesto |
| `Ejecutivo.cost` = `Resultado por tienda.cogs` | las dos usan `computeCostSheet` y solo las líneas "material" (con `order_fixed` dentro) |
| `Ejecutivo.fee` = `Resultado por tienda.payment_fees` = `Caja.totals.fees_cents` | es el mismo `pos_sale_payment.fee_cents`, con las anuladas fuera en los tres |
| `Ejecutivo.commission` = `Resultado por tienda.commissions` | misma base (neto) y misma precedencia de % (perfil, luego ficha de vendedor) |
| **`Ejecutivo.profit` = `Resultado por tienda.contribution`** | la ganancia bruta del Ejecutivo *es* la contribución del resultado |
| `Estado de cuenta.paid_cents` = `Caja.totals.payments_cents` | lo que el cliente pagó, por método, neto de reembolsos |
| `Estado de cuenta.insurance_cents` = `Caja.totals.receivable_cents` | la parte del seguro, por cobrar en las dos |
| `Estado de cuenta.balance_cents` = Σ `balance` de Pedidos de la tienda | el saldo es de la venta, no de la línea |
| `Σ series` de Caja = `totals` de Caja | la serie diaria y los totales por método salen de las mismas filas |
| `Σ by_seller` = `Σ by_day` = `total_cents` del estado de cuenta | son cortes del mismo conjunto |
| `Mapa.cost_cents` = `Ejecutivo.cost + Ejecutivo.fee` | el mapa junta las dos; `Mapa.fee_cents` permite separarlas |

### Lo que difiere **a propósito** (y no hay que "arreglar")

1. **Ganancia bruta vs. resultado del mes.** `Ejecutivo.profit` es la
   contribución: no lleva renta, salarios, servicios ni la parte de los costos
   compartidos, porque esos gastos no tienen hora ni producto al que pegarse.
   `Resultado por tienda.result` = contribución − fijos. Son dos preguntas
   distintas: "¿cuánto deja esta venta?" y "¿cuánto deja la tienda este mes?".
2. **Caja ve dinero que las ventas no ven.** Una venta anulada movió efectivo de
   verdad (entró y volvió a salir), así que el cajón lo registra en las dos
   direcciones y queda en cero; las ventas del mes, en cambio, ya no tienen esa
   venta. En el juego de datos: `cash.in_cents = 40000` pero
   `cash.net_cents = 20000`, y `Ejecutivo.sales = 377.00` sin los $200.00.
3. **Caja incluye el flotante y el dinero a mano; las ventas no.** Un retiro del
   dueño o la compra de papel salen del cajón y nunca aparecen como venta. Van
   a `movements_out_cents` y, si el dueño las registró además como partida del
   mes, al resultado de la tienda.
4. **`Σ by_method` del estado de cuenta = `paid + insurance`, no `paid`.** El
   seguro es un método en el mostrador y dinero por cobrar en la contabilidad.
5. **Vendedores lee el tablero de pedidos, no `sale_fact`.** Su `revenue` es el
   total del pedido de Medusa (lleva envío) y su exclusión es "estado terminal
   del pedido", no "venta anulada". Para un mes con envíos o con una anulación,
   `Vendedores.revenue` **no** es `Ejecutivo.sales`. Lo que sí coincide es la
   base de la comisión (`net_revenue`) y la ganancia (`profit`, que viene de
   `orderEconomics`).
6. **La dimensión "método de pago" suma más que el total.** Una venta pagada con
   dos métodos cuenta en los dos.
7. **Las reglas de costo son las de hoy.** Cambiar el costo de una marca cambia
   la ganancia del pasado, en el Ejecutivo y en el resultado por igual. Es
   deliberado: el dueño quiere ver su negocio con sus costos actuales. Una ficha
   de costo escrita a mano sobre un pedido solo se usa en Costos, nunca en los
   tableros.
8. **Un reembolso parcial de una venta que sigue viva no baja las ventas.**
   `sale_fact` no modela reembolsos: hoy solo se reembolsa al anular (y entonces
   la venta entera sale). Caja sí lo vería. Ver la pregunta 4 de abajo.

---

## Defectos encontrados y corregidos (1-nov-2026)

1. **`sellers.ts` — la comisión se pagaba sobre el bruto.** `commission` era
   `total del pedido × %`, con impuesto y envío dentro, mientras el Ejecutivo,
   el resultado de la tienda y el panel del propio vendedor la calculan sobre el
   neto. A quién perjudica: al dueño, que paga de más aproximadamente
   `% × (impuesto + envío)` de cada venta — con 10 % de comisión y 7 % de
   impuesto, unos $6.50 por cada $1,000 facturados. Corregido: nueva
   `netRevenueOf` y campo `net_revenue` en la fila; `commission` sale de él.
2. **`store-pnl.ts` — se cargaban las comisiones de cobro de ventas anuladas.**
   La venta anulada sale de las ventas netas (`status = 'active'`) pero su
   `fee_cents` seguía sumando. Perjudica a la tienda: una tarjeta anulada de
   $400 restaba $11.60 de resultado que nadie gastó. Corregido con
   `sumFeesByStore`, que une con `pos_sale` y descarta las anuladas — además de
   dejar el filtro de mes local en una función pura con prueba.
3. **`store-pnl.ts` — las comisiones ignoraban la ficha de vendedor.** Solo se
   leía `commission_pct` del perfil de la persona, mientras el Ejecutivo cae
   también a la ficha de vendedor. Un vendedor de referidos sin usuario del
   panel cobraba en el Ejecutivo y no aparecía en el resultado de la tienda.
   Corregido con `commissionsOf` y la misma precedencia.
4. **`store-pnl.ts` — ver una sola tienda le cargaba el 100 % de los costos
   compartidos.** El reparto "por ventas" usaba como pesos solo las tiendas en
   pantalla, así que filtrar por una tienda inflaba su parte de la renta
   compartida hasta el total. Corregido: los pesos se leen de todas las tiendas
   activas (`netSalesByStore`), con un agregado extra solo cuando la vista es
   más estrecha que la cadena.
5. **`store-pnl.ts` — el aviso "faltan costos" nunca salía.** `cost_rules_missing`
   medía *todas* las reglas, así que con el % de pasarela o la ganancia objetivo
   configurados daba `false` aunque no hubiera ni un costo de material.
   Corregido al mismo predicado del Ejecutivo (solo reglas de material).
6. **`cash-report.ts` — la serie diaria y los totales por método podían no
   cuadrar.** Los totales clasificaban efectivo/tarjeta con la bandera **actual
   del método** y la serie con la bandera **guardada en el pago**. Al destildar
   "cuenta como efectivo" en un método, el efectivo cobrado del mes cambiaba en
   una pantalla y no en la otra. Corregido: las dos usan la bandera de la fila,
   que es con la que el libro de caja se escribió.
7. **`cash-report.ts` — "efectivo que entró / salió" se quedaba corto en
   silencio.** `movements_in/out_cents`, `by_category` y la serie diaria se
   calculaban sobre el listado recortado a 5 000 movimientos, mientras el
   comentario del código prometía totales completos. Corregido con un agregado
   SQL por día, dirección y motivo sobre todo el período.
8. **`cash-report.ts` — un reembolso guardado en positivo sumaba como ingreso.**
   `refund_cents += -amount` convertía un `kind = 'refund'` con importe positivo
   en dinero cobrado. Hoy `voidSale` los escribe negativos, así que no había
   daño, pero una fila corregida a mano o un reembolso parcial futuro lo
   dispararía. Corregido: el signo se normaliza por `kind`.
9. **`sales-insights.ts` — el costo fijo y el fee del pedido perdían centavos.**
   Al repartirlos entre las líneas se redondeaba cada parte por separado, así que
   en una venta de tres líneas la suma podía quedar en 99 ¢ de un fijo de
   $1.00. Corregido con `allocateCents` (resto mayor): las partes suman exacto,
   y el caso de neto 0 (venta regalada) ya no reparte por una división por cero.
10. **`sales-analytics.ts` — el `share %` de un ranking estaba inflado.** Se
    dividía por la suma de las filas **devueltas** (tope 50), no por el total de
    la dimensión: con más de 50 marcas, cada cuota salía más alta y sumaban
    100 % de un subconjunto. Corregido con una ventana `SUM(...) OVER ()`, que
    se evalúa antes del `LIMIT`.
11. **`start-map.ts` — "mi comisión del mes" mostraba la de todos.** En el mapa
    de un administrador el filtro cubre todas las tiendas, así que
    `me.commission_month_cents` traía la factura de comisiones de la cadena
    presentada como la comisión personal del dueño. Corregido: solo sale cuando
    las líneas agregadas son las del propio usuario.
12. **`start-map.ts` — el "costo" del mapa no era el "costo" del Ejecutivo.**
    El mapa suma `costo + fee` en un solo número; el Ejecutivo los separa.
    Se mantuvo el significado (es el costo total de cobrar la venta) y se añadió
    `fee_cents` aparte, para que las dos pantallas se puedan cuadrar. Documentado
    arriba y fijado por prueba.
13. **`start-map.ts` — el dinero "en la calle" podía estar corto sin avisar.**
    Se leían 2 000 ventas abiertas sin bandera alguna. Ahora se lee una de más y
    sale `pending_truncated`.

### Rendimiento (antes → después)

| Dónde | Antes | Después |
|---|---|---|
| `store-pnl.ts monthPnl` | `listEstablishments()` **dentro del bucle** de partidas compartidas: una consulta por partida (N+1) | una sola lectura de tiendas por petición |
| `store-pnl.ts monthPnl` | agrupaba líneas y vendedores con `[...(map.get(k) ?? []), x]`: copia de array por fila, O(n²) en un mes grande | `push`, O(n) |
| `store-pnl.ts monthPnl` | reglas de costo y metadatos de producto en serie | en paralelo (`Promise.all`) |
| `sales-insights.ts loadOrderContext` | los dos agregados (totales por pedido y fees por venta) en serie | en paralelo: se espera el más lento, no la suma |
| `cash.ts views()` | `people.find()` y `terminals.find()` por **cada** línea del libro (hasta 20 000): O(líneas × personas) | índices `Map`, O(1) por línea |
| `lens-quote.ts computeLensBreakdown` | hasta 5 consultas **en cadena** por cotización (diseño → base → tratamiento foto → opción foto → tratamiento AR → opción AR) | 2 tandas en paralelo; está en la ruta caliente del POS y de cada paso del embudo web |
| `sales-analytics.ts salesBreakdown` | el total para el `share` se sumaba en JavaScript sobre la página | ventana SQL, sin consulta extra y además correcto |
| `cash-report.ts cashReport` | — | una consulta agregada más (y a cambio, totales completos) |
| `store-pnl.ts monthPnl` | — | una consulta agregada más, solo si la vista es más estrecha que la cadena |

---

## Preguntas abiertas para el dueño

Cada una cambia una cifra. Están en orden de cuánto dinero mueven.

1. **¿La comisión del vendedor se paga sobre el neto (sin impuesto ni envío) o
   sobre todo lo que pagó el cliente?** Hoy todo el sistema usa el **neto** y la
   pantalla de Vendedores ya quedó igual. Si usted paga sobre el bruto, dígalo y
   lo cambiamos en los cinco sitios a la vez — pero entonces estaría pagando
   comisión sobre el impuesto que le entrega al estado.

2. **¿La comisión de cobro (tarjeta / Stripe) de una venta anulada se pierde o
   la recupera?** Ahora la quitamos del resultado del mes, porque la venta ya no
   existe. Si su procesador se queda con el fee aunque usted anule, es un gasto
   real y habría que dejarlo dentro (y el resultado bajaría).

3. **¿El envío de una venta web es ingreso suyo o se descuenta?** Hoy **no**
   entra en ventas ni en neto (no existe como línea en `sale_fact`) y en la
   ficha de costo es una deducción. Consecuencia que conviene que sepa: el % de
   pasarela que calculamos para una venta web se aplica sobre lo cobrado **sin
   envío**, así que si Stripe le cobra también sobre el envío, ese fee queda
   subestimado en unos centavos por pedido.

4. **¿Un reembolso parcial de una venta que sigue en pie debe bajar las ventas
   del mes?** Hoy no existe: solo se reembolsa al anular, y entonces la venta
   entera sale. Si quiere devolver $30 de una venta de $200 y que la venta siga
   viva, hay que decidir si el mes queda con $170 de venta (y cae la comisión y
   el impuesto a pagar) o con $200 de venta y $30 de gasto.

5. **¿Comparamos "este mes" contra el mes pasado **completo** o contra los
   mismos días del mes pasado?** Hoy es el mes completo, tal como lo pidió. El
   día 3 del mes usted ve 3 días contra 31 y la flecha sale roja siempre. Lo
   mismo con "esta semana" contra la semana pasada entera.

6. **¿Los precios que ve el cliente llevan el impuesto dentro?** En el POS,
   `unit_price` lo lleva (el impuesto se calcula después del descuento y se suma
   al total) y solo se cobra impuesto en una montura vendida **sin** lentes.
   Confirme que esa es la regla de su estado y que los lentes con receta están
   exentos: es el único supuesto fiscal del sistema.

7. **¿El seguro que ya cobró al paciente cuenta como venta del mes aunque el
   seguro no haya pagado todavía?** Hoy sí: la venta completa es venta del mes y
   la parte del seguro es dinero **por cobrar** (`insurance_cents`), fuera de la
   caja. Es lo correcto contablemente (devengo), pero significa que las ventas
   del mes son mayores que lo que entró al banco.

8. **¿Una partida de costo que arranca el día 28 debe cobrar el mes completo?**
   Hoy la vigencia se mira por mes, no por día: sí lo cobra completo. Si prefiere
   prorratear por días, se puede.

9. **¿Un estado de cuenta con más de 2 000 ventas en el período debe partirse en
   varios documentos?** Hoy avisa que está recortado, pero un documento recortado
   no sirve para firmar. Lo normal sería numerar `EST-…-01`, `-02`.

10. **¿La liquidación de una tienda familiar o en consignación se calcula sobre
    el neto facturado o sobre lo realmente cobrado?** Hoy es sobre el neto
    facturado (`total − impuesto`), incluidas las ventas con saldo pendiente. Si
    debe ser sobre lo cobrado, cambia cuando hay saldos en la calle.

---

## Apéndice: defecto fuera de los archivos auditados

`src/api/admin/sales-analytics/me/route.ts` llama
`openSessionFor(req.scope, terminalId)` pasándole el **id del punto de venta**,
pero esa función filtra por `establishment_id` (las sesiones son de la tienda
desde `CreatePos5`). Resultado: `workplace.cash_open` del panel del vendedor es
**siempre `false`**, aunque la caja esté abierta. Es una línea; el archivo es de
otra tanda de trabajo y se deja reportado en vez de tocarlo.
