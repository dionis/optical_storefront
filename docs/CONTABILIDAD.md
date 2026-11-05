# Contabilidad y finanzas del panel

Documento de referencia de **toda cifra de dinero** que el panel muestra: su
fórmula exacta, de qué tabla y columna sale, qué incluye, qué excluye, cómo
redondea, a qué período pertenece y quién puede verla.

Auditoría de contabilidad del 1-nov-2026. Lo que aquí se afirma está fijado por
pruebas: `apps/backend/tests/accounting-audit.test.ts` (una prueba por fórmula y
por defecto corregido) y `apps/backend/tests/accounting-reconciliation.test.ts`
(un mes de una tienda leído por las cinco pantallas, con las identidades que
deben cumplirse) y `apps/backend/tests/accounting-coherence.test.ts` (los
defectos de la verificación del 5-nov-2026 sobre base real, abajo). Si alguien
cambia una fórmula, esas pruebas fallan.

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
- **El instante de una venta de caja es `pos_sale.created_at`** (`saleInstantOf`
  en `sale-facts.ts`, desde el 5-nov-2026): es la columna por la que cortan el
  estado de cuenta y el informe de caja, así que `sale_fact.sold_at` y
  `sold_date_local` salen del mismo reloj. Antes se usaba `order.created_at`,
  que se escribe unos 200 ms antes: a las 23:59:59.9 locales la misma venta
  podía caer en dos días —y dos meses— distintos entre el Ejecutivo y el
  estado de cuenta. Un pedido web solo tiene su `created_at`.
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

### Meta mensual (`goal`, HU-40)

`staff_profile.monthly_goal` (dólares) contra el **neto del mes natural local**
de la persona: Σ (`total_cents` − `tax_cents`) de sus `sale_fact` activas con
`sold_date_local` entre el día 1 y hoy (`netByUser`). Es la **misma base que la
comisión** — nunca el bruto con impuesto, que es lo que `/sales-analytics/me`
usaba hasta el 5-nov-2026 (corregido: `done = total − tax`). `pct` = `done /
amount × 100`, un decimal, tope 100; `left = max(0, amount − done)`. La meta es
mensual, así que no cambia con el período elegido en pantalla. Lo exponen
`GET /admin/sellers/stats` (`sellers[].goal`, fijado por `goalProgress` con
prueba) y `GET /admin/sales-analytics/me` (`goal`).

## 7. Vendedores (`lib/sellers.ts`)

Desde el 5-nov-2026 la fuente es **`sale_fact`**, como el Ejecutivo
(`sellerFactOrders` en `lib/sales-analytics.ts`: una fila por pedido, el
mismo `applyFilter` de días locales y tienda). Antes leía la ventana del
tablero de pedidos (`scanBoardWindow`, `MAX_BOARD_SCAN`) y solo el
`metadata.seller_code` de referidos web, así que una vendedora de mostrador
(venta con `staff_code` / `seller_id`) salía con $0 mientras Ejecutivo →
Vendedores sí le atribuía la venta (QA D-13). Ya no hay ventana del tablero:
`truncated` solo pasa de `MAX_SELLER_STAT_ORDERS` (20 000) ventas en el período.

**Atribución (`attributeSale`, una venta → un vendedor, con prueba):**
1. la venta de caja es de **quien la registró** (`sale_fact.seller_id` =
   `seller.user_id`), sea cual sea el código que imprimió el recibo;
2. si no, el **código** de la venta (`sale_fact.seller_code`: el referido de
   un pedido web, o el código de recibo de un usuario sin ficha de vendedor);
3. si no, «sin vendedor» (`unattributed`).

Una venta que coincide con la misma ficha por usuario y por código cuenta una
vez; si el usuario es una ficha y el código otra, gana el usuario.

| Campo | Fórmula |
|---|---|
| `revenue` | Σ `total_cents` de las ventas atribuidas (lo cobrado, con impuesto; `sale_fact` no tiene línea de envío) |
| `net_revenue` | Σ (`total_cents` − `tax_cents`) — la base de la comisión, la misma del estado de cuenta y del Ejecutivo |
| `commission` | Σ por venta de `saleCommission`: el % del neto de **cada línea**, redondeado por línea (`Math.round(neto × % / 100)`), la misma aritmética de `lineEconomics` |
| `units` | Σ `qty` |
| `avg_ticket` | `revenue / orders` |
| `profit` | ganancia bruta de esos pedidos, vía `orderEconomics` (las mismas reglas del Ejecutivo) |
| `share_pct` | `revenue / (todo lo vendido en el período, atribuido o no)` |
| `by_source` | `counter` para una venta de caja; para un pedido web la red del enlace (`order.metadata.seller_source`, `referralSourcesByOrder`), `link` cuando no hay |

Una venta anulada o un pedido cancelado (`sale_fact.status = voided`) **no
genera nada para nadie**. Identidad nueva: `Σ revenue de Vendedores +
unattributed.revenue` = `Ejecutivo.sales` del mismo período y tienda.

**Redondeo (5-nov-2026).** La comisión se redondea **por línea**, en las
cuatro pantallas: Ejecutivo (`lineEconomics`), Resultado (`commissionsOf`),
Vendedores (`saleCommission` sobre `net_cents_lines`, que `sellerFactOrders`
devuelve por pedido) y el panel propio (`/admin/sales-analytics/me`,
`lineCommissionCents`: `SUM(ROUND(...))` en SQL). Redondear una vez sobre el
neto del período daba otro centavo: dos ventas de $71.33 al 8 % son
$5.71 + $5.71 = $11.42 por línea y $11.41 de una sola vez.

**El panel público del vendedor** (`/store/seller-dashboard`, enlace
`/vendedor?t=`) lee desde el 5-nov-2026 la **misma fuente**: `sellerFactOrders`
+ `attributeSale` con los mismos mapas que Vendedores (usuario de caja primero,
luego código), período por `sold_date_local`, comisión por línea sobre el neto
(`dashboardFigures`, pura). Identidad fijada por prueba: la fila del vendedor
en Vendedores = `totals` de su panel para el mismo período. Antes leía la
ventana del tablero (300 pedidos) por código de referido, con la comisión
sobre el bruto con impuesto. El número de pedido, la etapa y las iniciales del
cliente se leen del pedido solo para las filas mostradas
(`fetchBoardOrdersByIds`).

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
| `Ejecutivo.fee` = `Resultado por tienda.payment_fees` = `Caja.totals.fees_cents` | es el mismo `pos_sale_payment.fee_cents`, con las anuladas fuera en los tres (Caja las excluye desde el 5-nov-2026: `PaymentRow.sale_status`; antes sumaba el fee del anticipo con tarjeta de una venta anulada, porque el reembolso lleva fee 0) |
| `Ejecutivo.commission` = `Resultado por tienda.commissions` | misma base (neto) y misma precedencia de % (perfil, luego ficha de vendedor) |
| **`Ejecutivo.profit` = `Resultado por tienda.contribution` + `variable_manual`** | la ganancia bruta del Ejecutivo es la contribución del resultado **antes** de las partidas variables a mano del mes (luz, consumibles…), que no tienen hora ni producto al que pegarse. Sin partidas variables las dos cifras son iguales; con ellas, la contribución es menor exactamente en esa suma (base QA: Op2 sin ventas y $540 de luz → contribución −$540, Ejecutivo $0) |
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
5. **Ejecutivo → «vendedor» agrupa por código; Vendedores atribuye por usuario.**
   La dimensión `seller` del Ejecutivo usa `sale_fact.seller_code` (el código
   que imprimió el recibo, fijado al vender); Vendedores usa `attributeSale`
   (el usuario de caja primero). Una venta hecha antes de que el perfil tuviera
   código sale «sin vendedor» en el Ejecutivo aunque la persona exista. Las
   sumas totales coinciden siempre (`Σ sellers + unattributed = Ejecutivo.sales`).
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

## Notas del 5-nov-2026

- **Resumen por correo (digest, `lib/alerts-data.ts`)**: ahora sale de
  `sale_fact` (una fila por pedido), suma en **centavos enteros** y divide una
  vez al final; incluye pedidos web si la regla marca `include_web`; una venta
  anulada cuenta solo en «Anuladas». Antes sumaba `total_cents / 100` en punto
  flotante y solo leía `pos_sale`. «Tienda sin ventas» ignora las anuladas.
- **`sale_fact` se concilia solo**: el job `sale-fact-reconcile` (cada 6 h)
  proyecta los pedidos de los últimos 90 días que no tengan filas; y un pedido
  de mostrador que perdió `metadata.pos_sale_id`/`source` se recupera por
  `pos_sale.order_id`, de modo que no aparece como venta web sin tienda.
- **Entrega**: `pos_sale.delivered_at` se escribe con un UPDATE guardado (sin
  saldo, no anulada, no entregada) y la auditoría lleva `sale.deliver`.

## Verificación del 5-nov-2026 sobre base real local

Base `medusa_qa` del QA (4 tiendas, 9 ventas de caja —6 anuladas, 3 vivas por
$597.10—, 5 sesiones de caja, 6 aprobaciones, 17 pagos, 20 líneas del libro).
Script `qa/coherencia.cjs`: cada cifra se calcula **dos veces** (SQL sobre las
tablas y la API del panel con la sesión del dueño) y se imprime esperado / real
/ diferencia. Informe completo: `qa/COHERENCIA.md`. Primera pasada: 241
comprobaciones, 10 diferencias; tras corregir: **253 comprobaciones, 0
diferencias**.

Qué cuadró a la primera: Σ `pos_sale` = Σ `sale_fact` = Ejecutivo (global, por
tienda, por día, por hora local); libro de pagos = `paid + insurance`; los 9
pedidos con `sale_fact`; las 5 cajas (`apertura + entradas − salidas =
expected_cents`, la diferencia de −$3.00 una sola vez, Σ diff = informe);
`EST-Op1-202611` / `EST-Op2-202611` / `EST-ALL-202611` con sus cuatro
identidades; el resultado de Op1 recalculado a mano partida por partida,
**punto de equilibrio al centavo** (8 100 ÷ (466.49 / 597.10) = $10 367.87);
la economía de cada venta (montura de `store_frame_cost`, celda del lente,
fee `round(4000 × 2.9 %) + 30 = 146`); las 6 anuladas fuera de toda suma, con
número conservado, `paid`/`balance` a cero, pedido cancelado, una auditoría
`sale.void` cada una y aprobación `used`.

Defectos encontrados y corregidos (cada uno con prueba en
`tests/accounting-coherence.test.ts`):

1. **`cost_rules_missing` mentía.** Ejecutivo y Resultado mostraban «Aún no hay
   costos de monturas y lentes…: el costo de mercancía sale en cero» junto a un
   costo de $129.15: la bandera medía solo las reglas por marca (todas en 0) e
   ignoraba la lista del proveedor y el costo de la celda del lente. Ahora
   `costSourcesMissing(rules, frameCostsLoaded(), lensCellCostsKnown())`, la
   misma en las dos pantallas.
2. **Panel público del vendedor** portado a `sale_fact` (ver §7).
3. **Comisión redondeada por línea** en Vendedores y en el panel propio (§7).
4. **Un solo reloj para la venta de caja** (`saleInstantOf`, §0).
5. **Caja sumaba el fee de una venta anulada** (ver Conciliación).
6. **El documento afirmaba `Ejecutivo.profit = contribution`**: solo sin
   partidas variables a mano. Corregido arriba.

Sin cambio, para decidir: la «Comisión por defecto» de Precios (7 %) no se
aplica en ningún cálculo ni al crear una ficha (el formulario arranca en 10 %);
el rango «Todo» del panel público manda el mes en curso (página, no ruta);
partidas de costo duplicadas en la base QA (dato); 4 aprobaciones `approved`
sin usar que caducan a las 24 h.

### Las preguntas abiertas, tal como está el código hoy

| # | Pregunta | Lo que hace el código hoy (comprobado) |
|---|---|---|
| 1 | Comisión sobre neto o bruto | **Neto** (`total − impuesto`, sin envío) en las cinco pantallas, redondeado por línea. Base QA: Op2-000001 $151.72 con $11.56 de impuesto → base $140.16. |
| 2 | Fee de una venta anulada | **Se quita** en Ejecutivo, Resultado y, desde hoy, Caja. Si el procesador se lo queda, hoy el resultado sale alto en ese fee. |
| 3 | Envío de una venta web | **No es ingreso**: no existe en `sale_fact`; en la ficha de costo es deducción. El % de pasarela se calcula sobre lo cobrado sin envío. |
| 4 | Reembolso parcial | **No existe**: solo `voidSale` (venta entera, `UPDATE … WHERE status <> 'voided'`, un reembolso por pago). `pos_sale.paid_cents` y `balance_cents` quedan en 0 y el total se conserva para el listado. |
| 5 | «Este mes» vs mes pasado | Mapa de inicio: **mes/semana pasados completos**. Ejecutivo (`previousPeriod`): **el mismo número de días** justo antes de `from`. Son dos reglas distintas en dos pantallas; conviene unificar o decir cuál. |
| 6 | Impuesto en el precio | Solo en montura **sin lentes** (`frame-only`), tasa `store_setting.frame_tax_rate` (8.25 % en QA: $65.89 → $5.44), calculado **después** del descuento. Lentes con receta: 0. |
| 7 | Seguro como venta | **Sí**: el total completo es venta del período; `insurance_cents` es por cobrar, fuera de caja (`receivable_cents`) y dentro de `Σ by_method` del estado de cuenta. |
| 8 | Partida que arranca el día 28 | **Mes completo** (`monthlyCharge` compara `YYYY-MM`). |
| 9 | Estado de cuenta > 2 000 ventas | **Un solo documento recortado** con `truncated: true` y totales parciales; no se parte. |
| 10 | Liquidación | Sobre el **neto facturado** (`total − impuesto` de ventas no anuladas), con saldos pendientes dentro; `settlementFor` en el estado de cuenta y `store-pnl.ts` con la misma base. |

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
otra tanda de trabajo y se deja reportado en vez de tocarlo. *(Corregido después:
la ruta ya pasa el id de la tienda.)*
