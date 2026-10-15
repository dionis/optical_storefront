# Guía paso a paso — Dominio propio, correo de empresa, notificaciones dobles y Google Sheet

> Hito de CONFIGURACIÓN: el código ya lo soporta todo (Resend, varios correos de
> admin, y la hoja de Google que se escribe sola al confirmarse cada compra y en
> cada cambio de etapa). Stripe queda para el final, como pediste.
>
> Lo único que decides tú antes de empezar: **el nombre del dominio** (ej.
> `rubilens.com`) y **tu Gmail** (donde quieres recibir todo). Donde la guía
> dice `TUDOMINIO.com` y `TU-GMAIL@gmail.com`, pon los tuyos.

---

## PASO 1 — Comprar el dominio (Cloudflare, ~10 USD/año)

Recomiendo **Cloudflare Registrar** porque en un solo sitio tienes dominio, DNS
y el reenvío de correo gratis (lo usamos en el paso 3).

1. Crea cuenta en https://dash.cloudflare.com (puedes entrar con tu Gmail).
2. Menú **Domain Registration → Register Domain** → busca `rubilens.com` (o el
   nombre que quieras; si está cogido prueba `rubilens.shop`, `rubilensusa.com`…).
3. Cómpralo (tarjeta). Cloudflare vende a precio de costo y el DNS ya queda
   activo en tu cuenta — no hay que "conectar" nada más.

---

## PASO 2 — Apuntar el dominio a la tienda y al backend (DNS)

En Cloudflare → tu dominio → **DNS → Records**:

| Tipo  | Nombre | Contenido                | Proxy |
|-------|--------|--------------------------|-------|
| CNAME | `@`    | `cname.vercel-dns.com`   | DNS only (nube gris) |
| CNAME | `www`  | `cname.vercel-dns.com`   | DNS only |
| A     | `api`  | `161.153.9.98`           | DNS only |

Luego:

1. **Vercel** → proyecto del storefront → Settings → **Domains** → Add →
   `TUDOMINIO.com` y `www.TUDOMINIO.com`. Vercel valida solo (por los CNAME) y
   emite el certificado. Deja `www` → redirige a la raíz (o al revés, da igual,
   elige uno como principal).
2. **Coolify** → app del backend → **Domains** → añade `https://api.TUDOMINIO.com`
   (Coolify emite el certificado solo con Let's Encrypt).
3. Variables que cambian de valor:
   - En **Vercel** (storefront): `VITE_MEDUSA_URL=https://api.TUDOMINIO.com`
   - En **Coolify** (backend): a `STORE_CORS` añade
     `https://TUDOMINIO.com,https://www.TUDOMINIO.com` (deja también la URL de
     Vercel mientras pruebas).
4. Redeploy de los dos (Vercel se redespliega al guardar; en Coolify, Deploy).

Comprobación: `https://TUDOMINIO.com` abre la tienda; `https://api.TUDOMINIO.com/health` responde `OK`.

---

## PASO 3 — Correo del dominio: ENVIAR (Resend) y RECIBIR (reenvío al Gmail)

### 3A. Enviar como la empresa (Resend — gratis hasta 3.000 correos/mes)

1. Crea cuenta en https://resend.com (entra con tu Gmail).
2. **Domains → Add Domain** → `TUDOMINIO.com`. Resend te enseña 3–4 registros
   DNS (DKIM, SPF/MX de retorno). Cópialos tal cual en Cloudflare → DNS.
3. Espera a que Resend marque el dominio **Verified** (minutos).
4. **API Keys → Create API Key** (permiso "Sending access"). Cópiala (`re_...`).
5. En **Coolify** (backend) añade:
   ```
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=RUBI LENS <pedidos@TUDOMINIO.com>
   ```
   `pedidos@` no necesita "existir": al enviar con dominio verificado, Resend
   firma y sale. Las respuestas del cliente llegan por el paso 3B.

### 3B. Recibir en tu Gmail (Cloudflare Email Routing — gratis)

1. Cloudflare → tu dominio → **Email → Email Routing** → Enable (añade los MX solo).
2. **Destination addresses** → añade `TU-GMAIL@gmail.com` → confirma el correo
   de verificación que te llega.
3. **Routing rules**: crea `pedidos@TUDOMINIO.com → TU-GMAIL@gmail.com` (y si
   quieres, `Catch-all → TU-GMAIL@gmail.com` para no perder nada).
4. (Opcional, para RESPONDER como `pedidos@`): Gmail → ⚙️ → Cuentas → "Enviar
   como" → añade `pedidos@TUDOMINIO.com` usando SMTP de Resend
   (host `smtp.resend.com`, puerto 465, usuario `resend`, contraseña = tu API key).

---

## PASO 4 — Notificaciones a LOS DOS correos (Gmail + admin)

El backend ya envía cada aviso de pedido a **todos** los correos de la lista de
administradores (deduplicada, un correo por destinatario para que no se vean
entre ellos). Dos maneras — con una basta:

- **Panel de admin de la tienda** (`/admin` → Ajustes): campo
  **Correos de notificación de administradores** →
  `TU-GMAIL@gmail.com, admin@TUDOMINIO.com`
- **O por variable en Coolify**:
  ```
  STORE_ORDER_NOTIFICATION_EMAIL=TU-GMAIL@gmail.com
  STORE_ADMIN_NOTIFICATION_EMAILS=TU-GMAIL@gmail.com,admin@TUDOMINIO.com
  ```

Al CLIENTE siempre le llega desde `RESEND_FROM_EMAIL` → el correo de la
empresa, nunca desde el Gmail. Exactamente lo que pediste.

---

## PASO 5 — Google Sheet vinculado a tu Gmail (escritura al confirmar la compra)

El backend ya escribe solo, sin dependencias nuevas: pestaña **Pedidos** (una
fila por pedido, con cliente, artículos, totales, receta, tracking y su estado,
actualizada en cada etapa) y pestaña **Historial** (una fila por evento,
cronológico). Las pestañas y encabezados se crean solos con el primer pedido.

1. Con tu Gmail, crea una hoja en https://sheets.new — nómbrala p. ej.
   "Pedidos RUBI LENS". Copia el **ID** de la URL
   (`https://docs.google.com/spreadsheets/d/ESTE-ID/edit`).
2. **Service account** (la "llave de robot" que escribe en tu nombre):
   a. https://console.cloud.google.com → crea proyecto "rubilens" (con tu Gmail).
   b. **APIs y servicios → Biblioteca** → busca **Google Sheets API** → Habilitar.
   c. **IAM y administración → Cuentas de servicio → Crear**: nombre
      `sheets-pedidos` → Crear y listo (sin roles).
   d. Entra en la cuenta creada → **Claves → Agregar clave → JSON** → se
      descarga un `.json`. Dentro están `client_email` y `private_key`.
3. **Comparte la hoja** (botón Compartir de la hoja de cálculo) con ese
   `client_email` (…@…iam.gserviceaccount.com) como **Editor**.
4. En **Coolify** añade:
   ```
   GSHEET_SPREADSHEET_ID=ESTE-ID
   GSHEET_SERVICE_ACCOUNT_EMAIL=sheets-pedidos@….iam.gserviceaccount.com
   GSHEET_SERVICE_ACCOUNT_KEY=-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n
   ```
   (La clave es el campo `private_key` del JSON; se puede pegar con los `\n`
   escapados tal como viene.)

---

## PASO 6 — Deploy y prueba completa

1. **Coolify → Deploy** (este clic activa además todo lo pendiente: FedEx $28,
   rastreo por recibo, medidor nuevo).
2. Compra de prueba en `https://TUDOMINIO.com` con la tarjeta de prueba
   (4242 4242 4242 4242 · 12/34 · 123) y comprueba:
   - correo de confirmación AL CLIENTE desde `pedidos@TUDOMINIO.com`;
   - aviso de venta en TU-GMAIL **y** en admin@;
   - fila nueva en la hoja (Pedidos + Historial);
   - en `/admin` cambia la etapa del pedido → correo al cliente + fila en
     Historial + estado actualizado en Pedidos.

## Variables nuevas en Coolify — lista para copiar

```
RESEND_API_KEY=
RESEND_FROM_EMAIL=RUBI LENS <pedidos@TUDOMINIO.com>
STORE_ORDER_NOTIFICATION_EMAIL=TU-GMAIL@gmail.com
STORE_ADMIN_NOTIFICATION_EMAILS=TU-GMAIL@gmail.com,admin@TUDOMINIO.com
GSHEET_SPREADSHEET_ID=
GSHEET_SERVICE_ACCOUNT_EMAIL=
GSHEET_SERVICE_ACCOUNT_KEY=
SHIPPING_FEDEX_RATE=28
SHIPPING_FEDEX_ETA_DAYS=4
```

> Stripe (cuenta final, llave live y webhook) queda para el último hito, como
> acordamos — avísame con tus "peculiaridades" y lo preparamos aparte.
