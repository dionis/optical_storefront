# Plataforma de óptica online — Guía general

_Versión 27/10/2026. Describe la plataforma tal como está hoy (un solo inquilino en
producción: RUBI LENS) y lo que un dueño de óptica recibe cuando se le entrega su
tienda. La parte técnica de cómo se da de alta otra óptica está en
[MULTI-TENANT-TECNICO.md](MULTI-TENANT-TECNICO.md)._

---

## 1. Qué es

Una tienda online de **espejuelos con receta** lista para operar, más un **panel de
gestión** para el dueño y su equipo. El cliente final elige montura, configura sus
lentes paso a paso, sube su receta (la IA la lee por él), paga con tarjeta y sigue
su pedido sin crear cuenta. El dueño ve y mueve los pedidos, controla precios,
costos y márgenes, gestiona vendedores, sucursales y caja, y recibe avisos por
correo, SMS y en una hoja de Google.

Cada óptica que usa la plataforma tiene **su propia tienda, su propio dominio, su
propia cuenta de cobro y sus propios datos**. Nada de una óptica es visible para
otra.

## 2. Qué ve el cliente

| Paso | Qué ocurre |
|---|---|
| **Catálogo** | Monturas con filtros (marca, forma, color, material, medidas), buscador y fichas en español e inglés. |
| **Ficha de producto** | Fotos, medidas de la montura, colores, valoraciones y — si está activado — **probador virtual 3D** con la cámara. |
| **Configurador de lentes** | Asistente de 4 pasos inspirado en Zeelool: uso (monofocal, progresivo, lectura, sin receta), material, filtros/fotocromático, antirreflejo. El precio se recalcula en cada paso y **siempre lo confirma el servidor**. |
| **Receta** | El cliente escribe sus valores o **sube una foto**; la IA la lee, rellena el formulario y el cliente confirma. La imagen se guarda en un almacenamiento privado (dato de salud). |
| **Pago** | Resumen completo del pedido, teléfono del paciente, avisos por correo/SMS opcionales y pago con tarjeta (Stripe; PayPal y Square disponibles). |
| **Mis pedidos** | Sin contraseña: el cliente recibe un enlace mágico en su correo y ve todos sus pedidos con su etapa (`confirmado → en laboratorio → enviado → en tránsito → entregado`). Puede escribir a soporte y, cuando la política lo permite, cancelar. |
| **Idioma** | Español por defecto, inglés con un clic. Moneda y fechas siguen el idioma. |

## 3. Qué ve el dueño: el panel `/admin`

Se entra con correo y contraseña. Barra lateral con iconos (cajón en móvil),
todo exportable a CSV o PDF, todo en español e inglés.

| Sección | Para qué sirve |
|---|---|
| **Pedidos** | Lista con filtros (texto, fechas, etapa, receta, vendedor). Detalle con receta, línea de tiempo, guía del courier y nota interna. "Avanzar etapa" hace la operación real (preparar envío, marcar enviado, entregado) y avisa al cliente. |
| **Ejecutivo** | Ventas, costos operacionales, resumen y detalle de ventas en una pantalla; cada tarjeta lleva al dato que la origina. |
| **Costos y precios** | Ficha de costo de cada venta (montura, lentes, laboratorio, envío, Stripe, comisiones), reparto porcentual (renta, marketing, …), ganancia objetivo y precio sugerido. Costos fijos de la tienda y resultado mensual. |
| **Precios de tienda** | Reglas de precio por sucursal, montura o estuche (porcentaje, ajuste, precio fijo, mínimo) con vigencia; importación desde hoja de cálculo. |
| **Punto de venta (POS)** | Venta en mostrador, caja (apertura, movimientos, cierre y cuadre), aprobación de descuentos, documentos de venta, reclamaciones a seguros. |
| **Vendedores** | Código de referido (`?ref=CODIGO`), enlaces por red social, comisión, ranking y un panel privado para cada vendedor sin necesidad de login. |
| **Sucursales** | Varias tiendas físicas de la misma óptica (propia, familiar, socio, consignación) con su liquidación. |
| **Equipo** | Personas que usan el panel y su rol (ver §4). |
| **Alertas** | Reglas de aviso de ventas (umbral, día, vendedor). |
| **Auditoría** | Registro de quién cambió qué. |
| **Catálogo y media** | Gestión del catálogo y generación de fotos/vídeo de monturas con IA (con presupuesto mensual). |
| **Seguridad** | Semáforo de configuración: secretos, https, Stripe en vivo, webhook, correo, SMS, hoja de Google, OCR. Nunca muestra valores. Incluye la "zona de peligro" para borrar pedidos de prueba. |
| **Ajustes** | Correos y teléfono del dueño para avisos, lista de administradores a notificar, correo de soporte, proveedor de pago activo, impuesto de montura, modelo de IA para recetas. |

### Hoja de Google

Cada pedido se replica en una hoja del dueño (pestañas Resumen, Buscar, Pedidos,
Historial, Costos). Dos columnas funcionan en ambos sentidos: **Estado** y **Guía
(tracking)** — el dueño puede mover un pedido desde la hoja y la tienda avisa al
cliente igual que desde el panel. Un cambio imposible (p. ej. "Entregado" sin
envío) se revierte en la hoja explicando el motivo.

### Avisos automáticos

- **Al cliente**: confirmación del pedido, cambios de etapa, enlace a sus pedidos,
  confirmación de cancelación (distinta si hubo reembolso o si el paquete ya iba en
  camino).
- **Al dueño y administradores**: cada pedido nuevo, cada cancelación (con el
  motivo y la regla que la permitió; si requiere acción, el asunto empieza por
  `ACCIÓN:`), alertas de ventas.

## 4. Roles del equipo

| Rol | Puede |
|---|---|
| **Dueño** (`owner`) | Todo. Es el único que nombra o retira superadministradores. |
| **Superadmin** | Todo lo demás: precios, descuentos, alertas, configuración. |
| **Supervisor** | Supervisa sucursales asignadas, aprueba descuentos dentro de su límite. |
| **Encargado** (`manager`) | Opera su sucursal: caja, ventas, pedidos. |
| **Vendedor** | Vende en POS y ve sus propias ventas y comisiones. |

Cada rol puede limitarse a una o varias sucursales y llevar un límite de descuento
propio.

## 5. Políticas de negocio incluidas

- **Precio**: siempre calculado en el servidor; lo que muestra el navegador es
  informativo.
- **Laboratorio**: 10 días hábiles para tallar y montar.
- **Cancelación por el cliente**: solo cuando pasaron los 10 días hábiles **y** el
  pedido salió hace más de 24 h. Si no hay nada enviado, se cancela y reembolsa
  solo; si ya va en camino, se registra la cancelación y el equipo gestiona la
  devolución.
- **Envío**: tarifa fija configurable (hoy FedEx $28, 4 días a todo EE. UU.),
  recogida en tienda opcional, envío gratis por encima de un importe.
- **Recetas**: datos de salud, en almacenamiento privado, accesibles solo con
  enlaces temporales.

## 6. Cómo se entrega una tienda a un dueño nuevo

1. **Recogemos los datos de la óptica** (ficha en
   [MULTI-TENANT-TECNICO.md §6](MULTI-TENANT-TECNICO.md#6-ficha-del-inquilino-tenantjson)):
   nombre comercial y razón social, dominio, logo y colores, correo y teléfono de
   avisos, dirección de recogida, zona horaria, moneda, proveedor de monturas,
   precios y envíos.
2. **El dueño abre sus cuentas** (son suyas, no nuestras): Stripe (el dinero entra
   directamente en su banco), dominio, Google (la hoja), y opcionalmente Twilio
   para SMS. Nos da acceso o las claves.
3. **Montamos su copia** de la plataforma: servidor, base de datos, tienda web,
   almacenamiento privado de recetas, correo con su dominio.
4. **Cargamos su catálogo** y precios.
5. **Compra de prueba** con tarjeta real y reembolso; pestaña Seguridad en verde.
6. **Traspaso**: el dueño recibe un enlace de activación, crea su contraseña y
   queda como **Dueño** del panel. A partir de ahí da de alta a su equipo desde la
   pestaña Equipo. Nuestro usuario técnico queda como soporte o se retira.

## 7. Qué cuesta mantenerla

| Concepto | Orden de magnitud |
|---|---|
| Servidor (Hetzner + Coolify) | ~€4–10 / mes por óptica |
| Tienda web (Vercel) | plan gratuito o Pro compartido |
| Correo (Resend), SMS (Twilio) | según volumen; el SMS es opcional |
| IA (lectura de recetas, medición, fotos) | por uso; con límites por hora/día y presupuesto mensual |
| Stripe | comisión por cobro, en la cuenta del dueño |

## 8. Glosario rápido

- **Inquilino (tenant)**: una óptica cliente de la plataforma, con su despliegue propio.
- **Sucursal (establishment)**: una tienda física _dentro_ de una misma óptica.
- **Etapa**: el punto de la línea de tiempo en que está un pedido.
- **Ficha de costo**: desglose de lo que costó realmente una venta.
- **Hoja**: la hoja de Google espejo de pedidos del dueño.
