# Guía paso a paso — Hostinger: dominio, correo corporativo, notificaciones y Google Sheet

> Ya tienes el dominio en Hostinger y el correo corporativo. Esta guía te lleva
> paso a paso para conectarlo todo al despliegue actual (Vercel + Coolify).
>
> Donde dice `TUDOMINIO.com`, pon tu dominio real.
> Donde dice `tu@TUDOMINIO.com`, pon tu correo corporativo de Hostinger.
> Donde dice `TU-GMAIL@gmail.com`, pon tu Gmail personal de respaldo.
> Stripe queda para el último hito, como acordamos.

---

## PASO 1 — Configurar DNS en Hostinger (apuntar a Vercel y al backend)

Entra en https://hpanel.hostinger.com → tu dominio → **DNS / Zona DNS**.

Hostinger crea varios registros por defecto (A, MX, etc.). Necesitas **añadir o
modificar** estos tres:

| Tipo  | Nombre (Host) | Apunta a (Valor)         | TTL    |
|-------|---------------|--------------------------|--------|
| CNAME | `www`         | `cname.vercel-dns.com`   | 14400  |
| A     | `@`           | `76.76.21.21`            | 14400  |
| A     | `api`         | `161.153.9.98`           | 14400  |

**Notas importantes:**

- **`@` (raíz)**: Hostinger no permite CNAME en la raíz (igual que la mayoría de
  registradores). Usamos un registro **A** apuntando a la IP de Vercel
  (`76.76.21.21`). Vercel lo acepta así.
- **`www`**: CNAME normal a Vercel.
- **`api`**: registro A directo al servidor de Coolify (`161.153.9.98`).
- **NO borres los registros MX** que Hostinger puso para tu correo corporativo —
  si los borras, dejas de recibir correo.
- Los cambios de DNS pueden tardar hasta 24-48h en propagarse, pero normalmente
  funcionan en 5-30 minutos.

**Comprobación rápida** (desde tu terminal o desde https://dnschecker.org):
```
nslookup TUDOMINIO.com      → debe dar 76.76.21.21
nslookup www.TUDOMINIO.com  → debe dar cname.vercel-dns.com
nslookup api.TUDOMINIO.com  → debe dar 161.153.9.98
```

---

## PASO 2 — Agregar el dominio en Vercel (storefront)

1. Entra en https://vercel.com → tu proyecto del storefront
   (`optical-storefront-capri-storefront-to-production` o como se llame).
2. **Settings → Domains → Add**:
   - Añade `TUDOMINIO.com` → Vercel detecta el registro A y emite certificado SSL.
   - Añade `www.TUDOMINIO.com` → Vercel detecta el CNAME y emite certificado.
   - Configura uno como principal y el otro como redirect (recomiendo
     `TUDOMINIO.com` como principal, `www` redirige ahí).
3. **Settings → Environment Variables** → cambia:
   ```
   VITE_MEDUSA_URL=https://api.TUDOMINIO.com
   ```
   (Deja la variable vieja `https://api.161-153-9-98.sslip.io` hasta que
   compruebes que `api.TUDOMINIO.com` funciona, luego la borras.)
4. **Redeploy**: Vercel se redespliega automáticamente al guardar las variables.

**Comprobación**: `https://TUDOMINIO.com` abre la tienda.

---

## PASO 3 — Agregar el dominio en Coolify (backend API)

1. Entra en Coolify → tu app del backend Medusa.
2. **Settings → Domains** (o General → Domains según la versión):
   - Añade `https://api.TUDOMINIO.com`
   - Deja también `https://api.161-153-9-98.sslip.io` (para no romper nada
     mientras migras).
   - Coolify genera el certificado SSL con Let's Encrypt automáticamente.
3. **Environment Variables** → modifica `STORE_CORS`:
   ```
   STORE_CORS=https://TUDOMINIO.com,https://www.TUDOMINIO.com,https://optical-storefront-capri-storefront-to-production.vercel.app
   ```
   (Deja la URL de Vercel mientras pruebas; cuando todo esté estable la puedes
   quitar.)
4. **Deploy** en Coolify.

**Comprobación**: `https://api.TUDOMINIO.com/health` responde `OK`.

---

## PASO 4 — Correo corporativo: ENVIAR desde la tienda (Resend)

Tu correo corporativo de Hostinger (`tu@TUDOMINIO.com`) ya **recibe** correo
(Hostinger lo maneja con sus MX). Lo que falta es que **la tienda envíe** correos
de notificación al cliente como si fuera la empresa. Para eso usamos **Resend**
(gratis hasta 3.000 correos/mes).

### 4A. Crear cuenta en Resend y verificar el dominio

1. Entra en https://resend.com (puedes registrarte con tu Gmail o con tu correo
   corporativo).
2. **Domains → Add Domain** → escribe `TUDOMINIO.com`.
3. Resend te mostrará **3-4 registros DNS** que necesitas agregar. Típicamente:

   | Tipo  | Nombre (Host)                        | Valor                                  |
   |-------|--------------------------------------|----------------------------------------|
   | TXT   | `resend._domainkey.TUDOMINIO.com`    | `p=MIGfMA0GCS...` (clave DKIM larga)  |
   | TXT   | `TUDOMINIO.com`                      | `v=spf1 include:amazonses.com ~all`    |
   | MX    | `send.TUDOMINIO.com`  (o `feedback`) | `feedback-smtp.us-east-1.amazonses.com`|

   **CUIDADO con el registro SPF (TXT en la raíz)**: Hostinger ya tiene un TXT
   con `v=spf1 ... ~all` para su propio correo. **No crees otro** — edita el
   existente y **combina** los dos:
   ```
   v=spf1 include:_spf.hostinger.com include:amazonses.com ~all
   ```
   (Un dominio solo puede tener UN registro SPF; si pones dos, ambos fallan.)

   **El MX de Resend** (`send.TUDOMINIO.com` o `feedback.TUDOMINIO.com`) es para
   el bounce handling de Resend, NO es el MX principal. NO toques los MX de
   Hostinger (`mx1.hostinger.com`, etc.) — esos son los de tu correo corporativo.

4. Vuelve a Resend y espera a que marque el dominio **Verified** (puede tardar
   de 5 minutos a 1 hora).

5. **API Keys → Create API Key** → permiso "Sending access" → copia la clave
   (`re_...`).

### 4B. Configurar en Coolify

En Coolify → tu app del backend → **Environment Variables**, añade:

```
RESEND_API_KEY=re_TU-CLAVE-AQUI
RESEND_FROM_EMAIL=RUBI LENS <pedidos@TUDOMINIO.com>
```

`pedidos@TUDOMINIO.com` no necesita "existir" como buzón real en Hostinger:
Resend envía con el dominio verificado y firma DKIM. Lo que importa es:

- Los correos **al cliente** salen como `pedidos@TUDOMINIO.com` (profesional).
- Si el cliente **responde**, el correo llega a `pedidos@TUDOMINIO.com` — pero
  ese buzón no existe en Hostinger (a menos que lo crees). Dos opciones:
  - **Opción A (recomendada)**: En Hostinger, crea una **redirección de correo**
    (hPanel → Emails → Forwarders) de `pedidos@TUDOMINIO.com` hacia
    `tu@TUDOMINIO.com` (tu correo corporativo real). Así las respuestas te
    llegan.
  - **Opción B**: Crea `pedidos@TUDOMINIO.com` como buzón real en Hostinger (si
    tu plan lo permite).

---

## PASO 5 — Notificaciones a DOS correos (corporativo + Gmail)

El backend ya envía cada aviso de pedido a **todos** los correos de la lista de
administradores (deduplicada, un correo por destinatario para que no se vean
entre ellos).

En **Coolify**, añade estas variables:

```
STORE_ORDER_NOTIFICATION_EMAIL=tu@TUDOMINIO.com
STORE_ADMIN_NOTIFICATION_EMAILS=tu@TUDOMINIO.com,TU-GMAIL@gmail.com
```

O si prefieres hacerlo desde el **panel de admin** de la tienda:
`https://TUDOMINIO.com/admin` → Ajustes → **Correos de notificación de
administradores** → `tu@TUDOMINIO.com, TU-GMAIL@gmail.com`

Resultado:
- Cada pedido nuevo → notificación a tu correo corporativo **Y** a tu Gmail.
- Al cliente → siempre le llega desde `pedidos@TUDOMINIO.com` (la empresa).
- Cada cambio de etapa → notificación a ambos + correo de actualización al cliente.

---

## PASO 6 — Google Sheet vinculado (registro automático de pedidos)

El backend ya escribe automáticamente: pestaña **Pedidos** (una fila por pedido
con cliente, artículos, totales, receta, tracking y estado, actualizada en cada
etapa) y pestaña **Historial** (una fila por evento, cronológico). Las pestañas
y encabezados se crean solos con el primer pedido.

### 6A. Crear la hoja

1. Con tu Gmail (`TU-GMAIL@gmail.com`), ve a https://sheets.new
2. Nómbrala por ejemplo **"Pedidos RUBI LENS"**.
3. Copia el **ID** de la URL:
   `https://docs.google.com/spreadsheets/d/`**ESTE-ID**`/edit`

### 6B. Crear la cuenta de servicio (el "robot" que escribe)

1. Ve a https://console.cloud.google.com → con tu Gmail.
2. **Crear proyecto** → nombre: "rubilens" (o el que quieras) → Crear.
3. En el proyecto, ve a **APIs y servicios → Biblioteca** → busca
   **"Google Sheets API"** → **Habilitar**.
4. Ve a **IAM y administración → Cuentas de servicio → Crear cuenta de servicio**:
   - Nombre: `sheets-pedidos`
   - ID: se genera solo (`sheets-pedidos@rubilens-XXXXX.iam.gserviceaccount.com`)
   - Sin roles → **Crear** → Listo.
5. Entra en la cuenta que acabas de crear → pestaña **Claves** →
   **Agregar clave → Crear clave nueva → JSON** → se descarga un archivo `.json`.
6. Abre el JSON: necesitas dos campos:
   - `client_email` → algo como `sheets-pedidos@rubilens-XXXXX.iam.gserviceaccount.com`
   - `private_key` → empieza con `-----BEGIN PRIVATE KEY-----`

### 6C. Compartir la hoja con el robot

1. Abre tu hoja de Google → botón **Compartir** → pega el `client_email` del
   JSON → dale permiso de **Editor** → Compartir.

### 6D. Variables en Coolify

```
GSHEET_SPREADSHEET_ID=ESTE-ID
GSHEET_SERVICE_ACCOUNT_EMAIL=sheets-pedidos@rubilens-XXXXX.iam.gserviceaccount.com
GSHEET_SERVICE_ACCOUNT_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
```

La clave es el campo `private_key` del JSON. Se puede pegar tal cual con los
`\n` escapados como vienen en el archivo.

---

## PASO 7 — Deploy y prueba completa

### 7A. Variables completas para Coolify (copia y rellena)

```
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=RUBI LENS <pedidos@TUDOMINIO.com>
STORE_ORDER_NOTIFICATION_EMAIL=tu@TUDOMINIO.com
STORE_ADMIN_NOTIFICATION_EMAILS=tu@TUDOMINIO.com,TU-GMAIL@gmail.com
GSHEET_SPREADSHEET_ID=
GSHEET_SERVICE_ACCOUNT_EMAIL=
GSHEET_SERVICE_ACCOUNT_KEY=
SHIPPING_FEDEX_RATE=28
SHIPPING_FEDEX_ETA_DAYS=4
```

(Añádelas a las que ya existen, no borres las demás.)

### 7B. Variables en Vercel (solo una cambia)

```
VITE_MEDUSA_URL=https://api.TUDOMINIO.com
```

### 7C. Deploy

1. **Coolify → Deploy** (activa todo: variables nuevas, FedEx $28, tracking,
   Google Sheet).
2. Vercel se redespliega solo al guardar las variables.

### 7D. Prueba completa

1. Abre `https://TUDOMINIO.com` → verifica que carga la tienda.
2. Abre `https://api.TUDOMINIO.com/health` → debe responder `OK`.
3. Haz una compra de prueba con la tarjeta `4242 4242 4242 4242 · 12/34 · 123`:
   - Correo de confirmación **al cliente** desde `pedidos@TUDOMINIO.com`
   - Aviso de venta en tu correo corporativo **Y** en tu Gmail
   - Fila nueva en la hoja de Google (Pedidos + Historial)
   - En `/admin` cambia la etapa del pedido → correo al cliente + fila en
     Historial + estado actualizado en Pedidos

---

## Resumen visual del flujo

```
Cliente compra
    │
    ├─ Email al cliente ← Resend (pedidos@TUDOMINIO.com)
    ├─ Email admin 1    ← Resend (→ tu@TUDOMINIO.com, Hostinger lo recibe)
    ├─ Email admin 2    ← Resend (→ TU-GMAIL@gmail.com)
    └─ Google Sheet     ← Service Account escribe fila
```

```
DNS:
  TUDOMINIO.com      → 76.76.21.21 (Vercel)      → storefront
  www.TUDOMINIO.com  → cname.vercel-dns.com       → storefront
  api.TUDOMINIO.com  → 161.153.9.98 (Coolify)     → backend Medusa
  MX (Hostinger)     → mx1/mx2.hostinger.com      → correo corporativo
```

> **Stripe** (cuenta final, llave live y webhook) queda para el último hito —
> avísame con tus "peculiaridades" y lo preparamos aparte.
