# Guía del Panel Corporativo — Óptica El Rancho

Panel de administración dentro de la misma web, pensado para el **dueño de la tienda**.

## Acceso
- URL: **`/admin`** (también hay un enlace discreto «Panel corporativo» en el pie de la tienda).
- Entra con **usuario + contraseña**. Credenciales por defecto:
  - Usuario: **`admin`**
  - Contraseña: **`RubiLens*Admin2026`**
- La sesión dura 8 horas y se cierra con el botón **Salir**.

> ⚠️ **Cambia la contraseña.** Es lo primero que deberías hacer. Ver «Cambiar credenciales».

## Qué puedes hacer

### Resumen
KPIs del negocio con filtro de tiempo (Hoy / 7 / 30 / 90 días / Año / Todo): **ingresos, pedidos,
ticket medio, accesos y conversión**, más gráficas de **ventas por día**, **embudo de conversión**
(accesos → vistas → carrito → compras), **ventas por marca** y **top productos**.

### Ventas
Ingresos y pedidos por día en el rango elegido, y la **tabla de pedidos recientes** con su total.

### Productos
**Monturas y estuches disponibles**, y las listas de **productos nuevos** y **ya no disponibles**
filtrables por tiempo (se llenan con el historial diario del servicio de catálogo), más el
**catálogo por marca**.

### Precios
Edita **cualquier precio** y se aplica en la tienda al instante:
- **Materiales de lente** (1.50, 1.59, 1.61, 1.67, 1.74) y **tratamientos** (antirreflejo, luz azul,
  fotocromático, tinte).
- **Tipo de lente / uso** (visión sencilla, progresivo, solo montura).
- **Envío** (estándar, exprés, umbral de envío gratis).
- **Accesorios / estuches** (precio por modelo).
- **Monturas** (precio por modelo, con buscador).
- **Exportar / Importar** todos los precios como JSON, y **Restablecer** a los valores base.

## Notas importantes (buenas prácticas / limitaciones actuales)
- **Autenticación:** hoy es un *gate en el cliente* (la contraseña viaja como hash SHA-256, nunca en
  texto plano). Mantiene fuera a usuarios casuales, pero **no es una barrera de seguridad real**
  porque todo corre en el navegador. Para producción/SaaS hay que conectar el login al **backend de
  Dionis** (autenticación real con token). El código ya tiene un único punto para eso:
  `src/admin/adminAuth.js` → variable `VITE_ADMIN_AUTH_URL`.
- **Datos de ventas:** como no hay (todavía) un backend de ventas disponible, el panel usa una capa de
  **analítica real en el navegador** (registra accesos, vistas, añadir-al-carrito y compras al hacer
  checkout) **+ datos demo** sembrados para que las gráficas no salgan vacías. El banner «datos demo»
  lo indica; el botón **Borrar demo** los elimina y deja solo lo real. Los datos viven en el navegador
  (localStorage) — para métricas reales multi-dispositivo hay que enviarlos al backend (el seam está en
  `src/admin/analytics.js`).
- **Precios:** los overrides se guardan en el navegador (localStorage) y se pueden exportar/importar.
  Para SaaS conviene persistirlos en el backend (seam en `src/admin/priceStore.js`).

## Cambiar credenciales
Genera el hash de tu nueva contraseña:
```
node -e "const c=require('crypto');process.stdout.write(c.createHash('sha256').update('TU_NUEVA_PASSWORD').digest('hex'))"
```
Y ponlo (junto al usuario) como variables de entorno de build, o edítalo en
`apps/capri-storefront/src/admin/adminAuth.js`:
```
VITE_ADMIN_USER=eldueno
VITE_ADMIN_PASS_SHA256=<hash generado>
```
Para conectar a un backend real de auth, define `VITE_ADMIN_AUTH_URL=https://.../auth`.
