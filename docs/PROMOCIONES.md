# Promociones por tienda y horario de las tiendas

Pedido del dueño (15-nov-2026): «se debe poder editar el horario de apertura y
cierre de cada tienda y manejarlo en el panel de admin. Además de promociones
por tienda, configura algunas 5 y que se puedan habilitar o deshabilitar según
necesidad o agregar otras, editar también […] compre 2 lleve 1 gratis, examen
de la vista gratis si compra con nosotros […] debe quedar claro qué es
descuento y qué es promoción; la promoción se hace por intervalo de tiempo».

## Descuento ≠ promoción

| | Descuento | Promoción |
|---|---|---|
| Qué es | un porcentaje | una oferta con nombre, tiendas y fechas |
| Quién lo pone | el dueño por artículo («Productos y precios» → `store_item_discount`, ya va en el precio; en pantalla dice «Descuento −X %») y el vendedor en la caja (con límite y aprobación) | el dueño en **Comercial → Promociones**; el vendedor la ELIGE en la venta cuando el paciente cumple la condición |
| Aprobación | sí, por encima del límite del vendedor o bajo el mínimo | no (la configuró el dueño) |
| En el recibo | «Descuento 10 %» | «Promoción «Segundo par al 50 %» (50 %)», o «Incluye: Examen de la vista…» |

**Nunca se suman**: si la venta lleva descuento tecleado y promoción con
porcentaje, se aplica el MAYOR de los dos (`saleDiscountPct`) y la venta dice
cuál fue (`discount_source`, `promotion.priced`). Con empate gana la promoción
(no pide aprobación).

## Tipos de promoción (`lib/promotions.ts`)

| `kind` | Efecto | Campos |
|---|---|---|
| `bogo` | «Compre N, lleve M»: la caja vende un par por venta, así que se aplica en la venta del par gratis (o rebajado) y pide el número de la(s) venta(s) pagada(s) (`promotion_ref`, obligatorio) | `buy_qty`, `get_qty`, `pct` (100 = gratis) |
| `percent` | X % de toda la venta | `pct` |
| `free_service` | servicio incluido sin cargo (examen de la vista): no cambia el precio, el recibo lo dice | `value_cents` (opcional, se imprime tachado) |
| `gift` | regalo con la compra (estuche, limpiador): igual | `value_cents` |

Todas: `establishment_ids` (NULL = todas las tiendas), `starts_on`/`ends_on`
(fechas de la tienda, inclusivas; NULL = sin límite), `is_active`,
`min_total_cents` (compra mínima sobre el precio de lista), `description`
(condiciones que lee el vendedor).

Estado de hoy (`promoState`): `live` · `off` (apagada) · `scheduled` (empieza
más adelante) · `ended`.

## Las cinco de ejemplo

Migración `establishment/CreateStorePromotion8` (solo si la tabla nunca tuvo
filas), **apagadas**: el dueño enciende las que quiera y pone sus fechas.

1. Compre 2, lleve 1 gratis (`bogo` 2/1 al 100 %)
2. Examen de la vista gratis con tu compra (`free_service`, valor $50)
3. Segundo par al 50 % (`bogo` 1/1 al 50 %)
4. Estuche y limpiador de regalo (`gift`, compras desde $150, valor $25)
5. Temporada escolar: 15 % en toda la compra (`percent` 15)

## API

- `GET/POST /admin/store-promotions`, `POST/DELETE /admin/store-promotions/:id`
  (con solo `{ is_active }` enciende/apaga). Solo dueño y superadmin. **No es
  `/admin/promotions`**: esa ruta es del motor de promociones de Medusa.
- Caja: `GET /admin/pos/context` trae por tienda `promotions` (las vivas hoy) y
  `hours`, más `timezone`. `POST /admin/pos/quote` y `POST /admin/pos/sales`
  aceptan `promotion_id` y `promotion_ref`; responden `promotion` y
  `discount_source`. Errores: `promo_not_available` (409: apagada, fuera de
  fechas u otra tienda), `promo_min_total` (422, `min`), `promo_ref_required`.
- La venta guarda una copia: `pos_sale.promotion` (migración `pos/CreatePos9`):
  `{ id, name, kind, pct, buy_qty, get_qty, value_cents, ref, priced }`. Sale en
  el recibo, la ficha de la venta y el documento (`doc.sale.promotion`).
- Auditoría: `promotion.change`, `promotion.delete`.
- Contabilidad: el dinero de una promoción con porcentaje es el descuento de la
  venta de siempre (`discount_cents`/`discount_pct`), así que tableros, estado
  de resultados e informe fiscal no cambian.

## Horario de las tiendas (`lib/store-hours.ts`)

`establishment.hours` (migración `establishment/CreateEstablishmentHours7`):

```json
{ "week": { "mon": { "open": "09:00", "close": "18:00" }, …, "sun": { "closed": true } },
  "special": [{ "date": "2026-12-25", "closed": true, "label": "Navidad" },
              { "date": "2026-12-24", "open": "09:00", "close": "13:00", "label": "Nochebuena" }] }
```

- Hora de la tienda (zona horaria del negocio, `tenant().timezone`); el cierre
  debe ser después de la apertura (no se aceptan horarios que pasan la
  medianoche). Un día especial manda sobre su día de la semana. Máx. 60.
- Se edita en **Tiendas → Horario** (`StoreHoursEditor.jsx`), con «Copiar el
  lunes a martes–viernes». `POST /admin/establishments/:id { hours }` (null lo
  quita). Auditoría `store.hours`.
- Dónde se usa (supuesto, el dueño no lo precisó): el directorio de Tiendas
  («Abierta · cierra 18:00» / «Cerrada · abre lun 09:00»), una línea al pie de
  los recibos («Horario: Lun–Vie 09:00–18:00 · Sáb 10:00–14:00 · Dom
  cerrado»), y la caja AVISA —sin bloquear— si se vende fuera de horario.
- El panel tiene una copia de la lógica (`src/admin/storeHours.js`); sus
  pruebas (`scripts/test-store-hours.mjs`) usan los mismos casos que las del
  servidor (`tests/store-hours-promotions.test.ts`).
