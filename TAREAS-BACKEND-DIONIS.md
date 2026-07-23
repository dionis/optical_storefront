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
