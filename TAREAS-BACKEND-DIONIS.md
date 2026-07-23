# Tareas de Backend — Óptica El Rancho (para Dionis)

**Contexto en una frase:** el frontend (la tienda + el panel del dueño) ya funciona, pero hoy
guarda los datos en el navegador (modo demostración). Para producción necesitamos que **el
backend guarde y valide estos datos de verdad**. Abajo están las tareas por función, en orden de
prioridad. Cada una dice **qué hace falta** y **por qué**, sin tecnicismos. Al final hay un
apéndice técnico con los “puntos de conexión” que el frontend ya dejó listos.

---

## 1. Cuentas de usuario y acceso (login de clientes)
**Qué:** que un cliente pueda **crear una cuenta** y **entrar con su correo y contraseña**,
recuperar la contraseña si la olvida, y cerrar sesión. Dejar preparada la **verificación en dos
pasos (2FA)** para más adelante.
**Por qué:** hoy entra cualquiera con cualquier correo (demo). En producción el acceso debe ser
real y seguro. *El frontend ya tiene lista la pantalla de código 2FA para cuando exista.*

## 2. Acceso del dueño / administradores (panel)
**Qué:** un acceso **aparte para el dueño y personal autorizado**, con permisos de administrador;
que **solo ellos** puedan ver las ventas y cambiar precios.
**Por qué:** el panel maneja información sensible (ventas, precios).

## 3. Favoritos del cliente
**Qué:** guardar la **lista de favoritos de cada cliente en su cuenta** (no solo en su navegador).
**Por qué:** para que los vea desde cualquier dispositivo (móvil, computadora).

## 4. Compras / pedidos
**Qué:** registrar cada compra — **qué productos, cantidades, precios, total, fecha y de qué
cliente** — y que el cliente vea su **historial de compras**.
**Por qué:** hoy las compras son de demostración; necesitamos pedidos reales y guardados.

## 5. Seguimiento de pedidos (envíos)
**Qué:** guardar el **estado de cada pedido** (en preparación → enviado → en camino → entregado) y,
si aplica, el **número de guía** del transportista, para que el cliente **rastree su pedido**.
**Por qué:** el frontend ya tiene la pantalla **“Seguimiento (próximamente)”** lista para mostrarlo.

## 6. Reseñas / comentarios de productos
**Qué:** guardar las **reseñas por cliente** (estrellas + comentario) y permitir que el cliente
**edite o borre las suyas**.
**Por qué:** hoy se guardan en el navegador; deben ser permanentes y ligadas a la cuenta.

## 7. Precios (los que el dueño edita en el panel)
**Qué:** guardar los precios que el dueño define en el panel — **marcos por modelo, materiales de
lente, tratamientos, tipo de lente, envío y accesorios** — y que la tienda los lea del backend.
**Por qué:** hoy los cambios de precio viven en el navegador del dueño; deben valer para todos los
clientes.

## 8. Métricas / analítica de ventas
**Qué:** contar de verdad los **accesos, vistas de producto, añadidos al carrito y compras** para
las gráficas del panel.
**Por qué:** hoy son datos demo + del navegador; para métricas fiables deben venir del servidor.

---

## Orden de prioridad sugerido
1. **Accesos** (tareas 1 y 2) — sin cuentas, lo demás no se puede ligar a un cliente.
2. **Compras, favoritos y reseñas** (4, 3, 6) — el corazón de la cuenta del cliente.
3. **Seguimiento de envíos** (5).
4. **Precios** (7).
5. **Métricas** (8).

---

## Apéndice técnico (opcional — “enganches” que el frontend ya dejó listos)
El frontend expone un **único punto de conexión por caso**, así que en la mayoría solo hay que
apuntar a tu endpoint. Todo intercambia **JSON**.

| Función | Dónde conectar (archivo / variable) |
|---|---|
| Login panel / 2FA | `VITE_ADMIN_AUTH_URL`, `VITE_ADMIN_2FA_URL` en `src/admin/adminAuth.js` (`authenticate`, `verifyOtp`) |
| Login cliente | `src/components/userAuth.js` (`login`, `register`, `logout`, `getUser`) |
| Favoritos | `src/components/CartContext.jsx` (`favorites`, `toggleFav`) |
| Pedidos / compras | `src/admin/analytics.js` (`recordOrder`, `ordersByUser`) |
| Seguimiento | campo `status` del pedido (`processing` / `shipped` / `delivered`) ya previsto |
| Reseñas | `src/components/reviewsStore.js` (`listByUser`, `updateReview`, `removeReview`) |
| Precios | `src/admin/priceStore.js` (`load`/`save`, hoy localStorage) |
| Catálogo | ya resuelto: servicio publica `catalog.json`; `VITE_CATALOG_URL` apunta al hosting |
| Métricas | `src/admin/analytics.js` (`track*`, `summarize`) |

Cuando definas la tecnología del backend (p. ej. Medusa v2, que ya está en el repo), podemos
detallar el **contrato exacto de cada endpoint** (campos de entrada y salida).


---

# Ampliación (nuevos cimientos ya montados en el frontend, demo → backend)

Todo lo de abajo ya funciona en modo demo (navegador) y queda listo para conectar.

## 9. Identidad del cliente para comprar
**Qué:** para finalizar la compra el cliente se identifica con **correo + celular** y da
**nombre y apellidos**. Con eso podrá luego **rastrear** su pedido y **comentar**.
**Backend:** cuenta/usuario con email + teléfono verificables (idealmente **OTP al celular** =
la base del 2FA que ya está previsto), y guardar nombre/apellidos en el perfil.

## 10. Datos de entrega en el pedido
**Qué:** si el cliente elige **envío a domicilio**, en el pago captura **dirección, ciudad, y el
contacto de quien recibe** (nombre, celular, correo). Si elige **recogida en tienda**, no.
**Backend:** guardar estos datos con cada pedido; validarlos.

## 11. Envío: recogida, zonas y transportistas
**Qué:** el dueño configura en el panel: **recogida en tienda** (dirección y horario — por defecto
la sucursal de **Fry Rd, Katy**), **origen de envío**, y **zonas** (destino → transportista, costo y
**tiempo estimado**), incluida **Cuba** por consignataria. El cliente ve costo y tiempo estimado.
**Backend / integración real:** conectar **cotización en vivo** con FedEx / UPS / DHL / consignataria
(peso, dimensiones, origen Fry Rd → destino) para reemplazar la tabla de zonas por tarifas reales.

## 12. Estados del pedido y seguimiento (tracking)
**Qué:** cada pedido tiene un **proceso**: En preparación → Enviado → En camino → Entregado. En el
panel hay un **registro detallado de todos los pedidos** (cliente, método, destino, total, artículos,
y su estado, editable). El cliente ve una **línea de seguimiento** en «Mi cuenta».
**Backend:** guardar el estado y el **número de guía**; recibir **webhooks del transportista** para
actualizar el estado automáticamente y calcular el **tiempo aproximado** de entrega.

## 13. Reseñas con foto del cliente
**Qué:** el cliente puede **subir fotos suyas con el producto** en su reseña; se ven en el producto
y en «Mis reseñas» (editables).
**Backend:** almacenar las imágenes en un **bucket/CDN** (no en base de datos), moderación básica, y
asociarlas a la reseña y al cliente.

## 14. Panel: registro de pedidos y buscador
**Qué:** el panel tiene la pestaña **Pedidos** (todos, en proceso, entregados) con detalle y cambio de
estado, y un **buscador de producto** para ir directo a editar su precio; las monturas se **agrupan por
marca**.
**Backend:** exponer los pedidos con paginación/*filtros* y permisos de administrador.

> Prioridad: 9 y 10 (identidad + datos de entrega) → 12 (estados/tracking) → 11 (cotización real de
> envío) → 13 (fotos en reseñas). El resto (14) es UI del panel ya resuelta.
