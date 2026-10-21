# secrets/ — claves locales del proyecto (NO se suben al repo)

Todo lo que pongas en esta carpeta queda ignorado por git (`secrets/*` en el
`.gitignore` de la raíz); solo este README se versiona para que la carpeta
exista en cada clon.

Qué va aquí (solo en tu PC, mejor dentro de una unidad cifrada):

- `stripe.txt`          → claves `sk_live_`/`sk_test_`, `whsec_` y códigos de respaldo
- `google-sheets.json`  → JSON de la cuenta de servicio de Google (Sheets/Drive)
- `twilio.txt`, `resend.txt` → tokens de SMS y correo

Qué NO va aquí: nada que la aplicación lea en ejecución. Las variables que usa
el backend en local se ponen en `apps/backend/.env` (también ignorado) y en
producción se cargan en Coolify / Vercel. Esta carpeta es un archivo de
respaldo, no una fuente de configuración.

Si alguna clave de esta carpeta llegara a salir del PC (chat, correo, captura),
se revoca en el panel del proveedor y se genera una nueva.
