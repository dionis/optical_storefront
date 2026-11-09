# Foto del paciente con la montura puesta

Decisión del dueño (9-nov-2026), para las tiendas físicas (POS). **Opcional.**

## Para qué
Antes de hacer los espejuelos se toma una foto del paciente con la montura elegida.
Al recogerlos en la tienda, quien entrega abre la venta y se la enseña: así el paciente
ve que sus espejuelos son los mismos del encargo.

## Dónde se toma y se ve
- **Nueva venta → paso Pago**: tarjeta «Foto con la montura puesta (Opcional)».
  Primero se marca «El paciente autoriza que se le tome esta foto»; sin esa casilla no
  aparecen los botones de cámara. La foto se sube **después** de registrar la venta:
  si falla, la venta queda y se avisa para añadirla desde su ficha.
- **Ficha de la venta** (Ventas de tienda, Pedidos, Cobros pendientes…): sección
  «Foto con la montura puesta». Mientras la venta está por entregar, la foto sale
  destacada con «Antes de entregar, compara los espejuelos con esta foto», y el
  diálogo de «Entregar» repite el aviso. Un toque la abre a pantalla completa.
  Desde ahí también se toma si faltó, se cambia o se quita.

## Privacidad: se queda en la tienda
- Bucket privado (`poswear/<uuid>.<ext>`). La fila `pos_sale` guarda la clave
  (`wearing_photo_key`, migración `CreatePos7`), que **nunca sale del backend**: el panel
  solo recibe `has_wearing_photo` y `wearing_photo_at`.
- No va en recibos, correos, ticket de laboratorio, hoja de Google, ficha de paciente
  ni analítica.
- Se lee solo por `GET /admin/pos/sales/:id/wearing-photo`: devuelve los bytes (nunca
  un enlace firmado) con `Cache-Control: private, no-store`. Cada lectura queda en
  Auditoría (`sale.wearing_photo_view`); tomar, cambiar o quitar, como `sale.wearing_photo`.
- Al cambiarla o quitarla se borra el archivo anterior del bucket. La puesta a cero de
  pedidos (`purge-orders`) también borra estos archivos.

## Quién puede
| Acción | Quién |
|---|---|
| Ver | Quien puede abrir la venta (vista completa o la de cobro: quien entrega) |
| Tomar / cambiar | Quien puede corregir la venta: quien la hizo o alguien por encima de su rol en esa tienda (`saleEditDenied`) |
| Quitar | Lo mismo, también en una venta anulada |

## API
- `POST /admin/pos/sales/:id/wearing-photo` `{ photo: dataURL, consent: true }` → `{ sale }`.
  Errores: `wearing_photo_consent`, `bad_wearing_photo` (JPG/PNG/WebP, ≤ 6 MB),
  `storage_unavailable` (503, sin bucket privado), `photo_upload_failed` (502).
- `DELETE …/wearing-photo` → `{ sale }`; `no_wearing_photo` (404) si no hay.
- `GET …/wearing-photo` → imagen.

Código: `lib/pos-wearing-photo.ts` (reglas puras), `lib/pos-wearing-photo-data.ts`,
`wearingPhotoDenied` en `lib/sale-permissions.ts`; panel `admin/WearingPhoto.jsx`.

## Requisito en el servidor
Necesita el bucket privado configurado (`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_PRESCRIPTION_BUCKET`), el mismo de las recetas y de las
fotos de la montura propia. Sin él la tarjeta responde «El almacenamiento privado de
fotos no está configurado».
