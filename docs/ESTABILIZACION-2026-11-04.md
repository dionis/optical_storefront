# Estabilización del POS — 4 de noviembre de 2026

> Rama `audit/estabilizacion-pos` sobre `develop_optical_storepos` (6ddebb6).
> Resultado de la auditoría integral (QA, fullstack, PM, dueño, diseño) hecha
> junto con la landing `opticaelrancho.com`, que ahora sirve este panel en
> `https://opticaelrancho.com/admin`. Todo lo de aquí tiene test unitario o
> comprobación automática; nada toca datos de negocio ni las tiendas dadas de alta.

## 1. Lo que corrige (y por qué)

| Área | Problema | Corrección | Dónde |
|---|---|---|---|
| Recibo por correo | La fecha salía en UTC: una venta de las 6 pm en Texas llegaba como «1:00 a.m. del día siguiente». | Formato con la zona de la tienda (`tenant().timezone`, `America/Chicago`), que ahora viaja en `SaleDocument.business.timezone`. | `src/lib/email/pos-emails.ts`, `src/lib/pos-documents.ts` |
| Fecha prometida y número de receta | `toISOString().slice(0,10)` daba la fecha UTC: desde las 6–7 pm el laboratorio recibía «mañana» como día de venta; el año de la secuencia `Rx-AAAA` giraba a las 6 pm del 31 de diciembre. | `promisedDate()` y `localYear()` (puras, `src/lib/pos.ts`) cuentan días hábiles sobre el calendario de la tienda. | `src/lib/pos-data.ts` |
| Recibo (correo e impreso) | Las líneas mostraban el precio **ya con descuento** y debajo «Descuento −X» otra vez: la suma de líneas no cuadraba con el total y se leía como doble descuento. | Las líneas van a **precio de lista**; subtotal, descuento e impuesto aparecen una sola vez. El total no cambia. | `pos-emails.ts`, `apps/capri-storefront/src/admin/SaleDocuments.jsx` |
| Aprobación de descuento | Se marcaba `used` al final de la venta: dos cajas (o un doble envío) podían vender dos veces con la misma aprobación. | Se **reclama primero** con `UPDATE … WHERE status='approved'` (atómico); si la venta falla se devuelve a `approved`. | `claimApproval` / `releaseApproval` en `pos-data.ts` |
| Anulación de venta | Dos confirmaciones simultáneas pasaban la comprobación `status !== 'voided'` y escribían **dos reembolsos**. | Una anulación por venta a la vez (`voiding`), con relectura del estado al tomar el turno. | `voidSale` → `doVoidSale` en `pos-data.ts` |
| Sesiones (M3) | Un JWT seguía valiendo tras cambiar la contraseña, al desactivar a alguien o si se filtraba. | `sessions_revoked_at` y `disabled_at` en la metadata del usuario; el guardia los comprueba en cada petición `/admin` (401 `session_revoked`, 403 `disabled`). | `src/lib/session-control.ts`, `staff-guard.ts`, `staff-scope.ts` |
| Recuperación de contraseña (M3) | No existía: una contraseña olvidada obligaba a que el dueño la restableciera. | `¿Olvidaste tu contraseña?` en el login → Medusa emite el token → correo con enlace → formulario de contraseña nueva → entra. Límite 5/h por IP y por correo. | `subscribers/auth-password-reset.ts`, `lib/email/password-reset.ts`, `lib/security.ts`, `AdminPage.jsx` |
| Desactivar sin borrar (M1/M3) | Solo existía «Eliminar», que borra el usuario y libera el correo. | `POST /admin/team/:id/active {active}`: la persona no entra, sus ventas, roles y auditoría quedan; reactivable. Mismos vetos que borrar. | `team/[id]/active/route.ts`, `Team.jsx` |
| Costes mayoristas en el bundle público | Cada producto del catálogo llevaba `supplierPrice` y `markup`. | Esos campos ya no salen en los objetos públicos; el panel de precios los calcula con `supplierPriceFor()`. Ver `docs/SEGURIDAD-PRECIOS.md` para lo que sigue pendiente por diseño. | `src/data/products.js`, `AdminDashboard.jsx` |
| Accesibilidad del panel y del checkout | Campos del checkout solo con placeholder; `input type=file` con `display:none` (inalcanzable con teclado); texto terciario `#98a0b1` (2,6:1); botones de 26–32 px en tablet. | `aria-label` en los campos; inputs de archivo ocultos visualmente pero enfocables; `--adm-faint` a 4,7:1 (claro) y 6,1:1 (oscuro); objetivos de 44 px con `pointer: coarse`. | `MedusaCheckout.jsx`, `admin.css` |
| SEO de la tienda | Sin `robots.txt` ni `sitemap.xml` (la SPA devolvía HTML); sin schema de organización. | `scripts/gen-seo.mjs` los genera en cada build desde el catálogo (569 URL); `Organization` JSON-LD en `index.html`. | `apps/capri-storefront/scripts/`, `index.html` |
| `vercel.json` duplicado | El de la raíz (que Vercel no lee) había divergido. | Eliminado junto con `scripts/vercel-build.sh` de la raíz; `check-vercel-config.mjs` falla si reaparecen. | raíz, `scripts/check-vercel-config.mjs` |
| CI | «Deploy to Coolify» no dependía de «Backend migrates and boots»; el job probaba con `medusa develop`, no con la build de producción. | `deploy` necesita `backend-boot` y `check-config`; el job compila con `medusa build` antes de migrar y arrancar. | `.github/workflows/ci.yml` |
| Migraciones al arrancar | `docker-entrypoint.sh` ignoraba un `db:migrate` fallido en silencio. | Sigue arrancando (decisión previa, para no tumbar la tienda) pero deja `MEDUSA_MIGRATE_STATUS=failed`: `GET /version` lo muestra y la pestaña Seguridad lo marca en rojo. | `docker-entrypoint.sh`, `api/version`, `lib/security.ts` |
| Insignia «Consumo IA» | El panel pedía `/admin/ai-usage/status` cada 10 min aunque el backend respondiera 404 (staging desplegado en un commit anterior). | Deja de preguntar al primer 404. | `AdminDashboard.jsx` |

## 2. Rutas nuevas

| Ruta | Quién | Qué |
|---|---|---|
| `DELETE /admin/team/:id/sessions` | dueño, superadmin (no sobre sí mismo) | Cierra la sesión de esa persona en todos los equipos. |
| `DELETE /admin/team/me/sessions` | cualquier rol | «Cerrar sesión en todos mis equipos» (la propia también). |
| `POST /admin/team/:id/active` `{ active: boolean }` | dueño, superadmin | Desactiva / reactiva sin borrar. Vetos: dueño, uno mismo, superadmin solo por el dueño. |
| `POST /auth/user/emailpass/reset-password` `{ identifier }` | anónimo (5/h) | De Medusa; ahora con límite y con correo de entrega. |
| `POST /auth/user/emailpass/update` (Bearer = token del correo) | anónimo con token | De Medusa; fija la nueva contraseña. |

`GET /admin/team` añade `disabled_at`; `GET /version` añade `migrations`;
`GET /admin/security-status` añade `auth.password_reset_rate_limit` y
`db.migrations_applied`.

Variables nuevas (`apps/backend/.env.example`): `PASSWORD_RESET_RATE_LIMIT`,
`ADMIN_PANEL_URL` (poner `https://opticaelrancho.com/admin` para que el enlace
de recuperación lleve al dominio de la óptica).

## 3. Auditoría

Acciones nuevas en `audit_event`: `password.recover` (reservada), `session.revoke`,
`user.disable`, `user.enable`. Como siempre, sin valores de contraseña ni tokens.

## 4. Cómo se probó

- `pnpm --filter @eyewear/backend typecheck`, `lint`; `pnpm --filter capri-storefront lint`; `node scripts/check-i18n.mjs` (5.036 claves × 2); `node scripts/check-vercel-config.mjs`.
- Tests nuevos: `pos-dates.test.ts`, `session-control.test.ts`, `password-reset-email.test.ts`; ampliados `pos-receipt-email.test.ts` (zona horaria, subtotal) y `security.test.ts` (migraciones).
- Suite completa del backend: 804 → 831 tests en verde (Windows, Node 24).

## 5. Lo que sigue pendiente (decisiones del dueño o trabajo mayor)

1. **Promover a producción**: `develop_optical_storepos` → `develop` → `main` por PR; el CI está en verde. Mientras tanto, los recibos reales salen de staging.
2. **Backend de staging desactualizado**: `api-staging` corre `2fa7d4c`; la rama va por `6ddebb6`. Redesplegar en Coolify (de ahí los 404 de «Consumo IA»).
3. **Datos de las tiendas**: Op2/Op3 sin dirección ni teléfono (salen en recibos y fichas). Se dejan como están por decisión del dueño; completar desde Tiendas → Editar.
4. **Venta transaccional**: `recordSale` encadena workflows de Medusa (carrito → pago → pedido → venta); un fallo a mitad deja un pedido sin `pos_sale`. Lo mitigan la clave de idempotencia y el reintento; la solución completa es un workflow de Medusa con compensación (trabajo de 1–2 días, probar en staging).
5. **Precios desde el servidor** (`VITE_USE_MEDUSA=true`): mientras el precio público sea «coste × 3» calculado en el navegador, el coste se deduce del precio. Ver `docs/SEGURIDAD-PRECIOS.md`.
6. Módulos del documento aún parciales: devoluciones/cambios parciales y garantías (M8), caducidad de recetas (M6), consentimiento de marketing (M15), alerta de pedido atrasado en laboratorio (M11), códigos de barras e importación Excel (M5), exportación POS → Sheets (M17).
7. `publicar-*.bat` empujan directo a `develop`/`main`: pasar a PR con checks obligatorios en GitHub.
