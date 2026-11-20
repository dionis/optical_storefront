# Estabilización del POS (auditoría del 4-nov-2026) — nota de integración

> Rama de origen: `audit/estabilizacion-pos` (2 commits sobre `6ddebb6`:
> `3e18f34`, `b5123b5`), hecha por otra sesión el 4-nov. Integrada **a mano** en
> `develop_optical_storepos` el 5-nov-2026. Sus notas originales son
> `git show origin/audit/estabilizacion-pos:docs/ESTABILIZACION-2026-11-04.md`
> y `docs/SEGURIDAD-PRECIOS.md` (esta última sí se trajo, adaptada).

## No fusionar `audit/estabilizacion-pos` tal cual

Entre el 4 y el 5 de noviembre `develop_optical_storepos` recibió 22 commits
que ya resolvían, de otra manera, tres de sus puntos. Un `git merge` o
`cherry-pick` de esa rama **volvería a añadir los duplicados** (segunda ruta de
desactivación, segunda recuperación de contraseña, claves de `translations.js`
que chocan con los `parts/`, y un `voiding` en memoria sobre un `voidSale` que ya
no existe en esa forma). El PR debe **cerrarse con un enlace a esta nota**; todo
lo que valía ya está aquí.

## Reemplazado por `develop_optical_storepos` (no se portó)

| Punto de la auditoría | Lo que ya tiene esta rama | Dónde |
|---|---|---|
| Recuperación de contraseña (`lib/email/password-reset.ts`, `subscribers/auth-password-reset.ts`, `AdminPage.jsx`, claves en `translations.js`) | El mismo flujo de Medusa, con decisión pura testeada (`decideResetRecipient`: no se envía a usuarios desactivados), rate limit de petición **y** de canje, auditoría `password.reset_requested` | `src/lib/password-reset.ts`, `src/lib/email/password-reset-email.ts`, `src/subscribers/auth-password-reset.ts`, `src/lib/security.ts`, `AdminPage.jsx`, `i18n/parts/auth.js` |
| Desactivar sin borrar (`POST /admin/team/:id/active`, `disabled_at` en la metadata del usuario, `user.disable/enable`) | `POST /admin/team/:id/status {active}`, `staff_profile.disabled_at/disabled_by` (migración `StaffProfileDisabled4`), vetos `statusChangeDenied`, auditoría `user.deactivate/reactivate`, chip «Inactivo» | `src/api/admin/team/[id]/status/route.ts`, `src/lib/staff-scope.ts`, `src/lib/staff-profile-data.ts`, `Team.jsx`, `i18n/parts/team.js` |
| Reclamo atómico de la aprobación de descuento (`claimApproval` con `UPDATE … WHERE status='approved'`) | Igual idea, con planes SQL puros y testeados: `approvalClaimPlan` / `approvalReleasePlan` / `approvalDecisionPlan`, además de `paymentClaimPlan` (cobro de saldo) y `deliveryClaimPlan` (entrega) | `src/lib/pos-data.ts`, `tests/pos-data-atomic.test.ts` |

## Portado hoy (adaptado al código actual)

| Punto | Qué se hizo | Dónde |
|---|---|---|
| Fechas en la zona de la tienda | `localDateISO` / `localYear` / `promisedDate` (puras; zona inválida → UTC, nunca se para la caja). `promised_on` y el año de la secuencia `Rx-AAAA` se calculan con `tenant().timezone`. `isoDay` (fecha de la receta) **no** se cambió: `rx_date` es una columna `DATE` que pg devuelve como medianoche del servidor, así que el corte UTC ya es el día guardado y desplazarlo restaría un día. | `src/lib/pos.ts`, `src/lib/pos-data.ts`, `tests/pos-dates.test.ts` |
| Fecha del recibo por correo | `SaleDocument.business.timezone` y `formatInZone` (zona desconocida → UTC). | `src/lib/pos-documents.ts`, `src/lib/email/pos-emails.ts`, `tests/pos-receipt-email.test.ts` |
| Recibo sin «doble descuento» | Líneas a **precio de lista**; fila «Subtotal (precio de lista)» cuando hay descuento o impuesto; descuento e impuesto una sola vez; el total no cambia. También en el recibo térmico y el doble impreso (el doble ya traía Subtotal pero con líneas descontadas, que no sumaban). | `pos-emails.ts`, `apps/capri-storefront/src/admin/SaleDocuments.jsx` |
| Anulación sin doble reembolso | En vez de su `Map` `voiding` en memoria (un solo proceso), un reclamo atómico al estilo de los demás: `voidClaimPlan` = `UPDATE pos_sale SET status='voided', voided_at, voided_by, void_reason, void_note WHERE id=? AND status<>'voided' RETURNING …`; 0 filas → relectura → 409 `sale_voided` (404 si desapareció). Solo quien gana cancela el pedido, escribe los reembolsos (sobre los pagos **actuales**, no los de la pantalla), rechaza reclamaciones, libera la bandeja y audita. Un fallo posterior deja la marca y queda en el log con `marked voided but a follow-up failed`. | `src/lib/pos-data.ts`, `tests/pos-data-atomic.test.ts` (4 tests nuevos) |
| Revocación de sesiones | `staff_profile.sessions_revoked_at` (migración `StaffProfileSessions5`, junto a `disabled_at`: `getStaffScope` ya lee esa fila en cada petición, así que no hay consulta extra; la metadata del usuario, donde lo guardaba la auditoría, no la lee nuestro scope). `tokenIssuedAtMs` toma el `iat` del payload verificado que Medusa deja en `req.auth_context` (comprobado en `authenticate-middleware.js`: devuelve el JWT verificado entero), con respaldo decodificando el Bearer. El guardia responde 401 `session_revoked` **antes** del chequeo de rol (admins incluidos); un token del mismo segundo sobrevive. `revokeSessions` invalida la caché de 30 s y audita `session.revoke` (acción reutilizada; **no** se añadieron `user.disable/enable`). Rutas `DELETE /admin/team/:id/sessions` (vetos de `passwordResetDenied`) y `DELETE /admin/team/me/sessions` (en la allowlist de todos los roles). Revocación en `POST /admin/team/password` (el panel vuelve a iniciar sesión con la nueva al instante, `adminTeam.js`), en `POST /admin/team/:id/password` y, además de lo que traía la auditoría, al completar la **recuperación por correo** (middleware `revokeSessionsAfterPasswordRecovery` sobre el 200 de `/auth/user/emailpass/update`; Medusa no emite evento ahí). UI: «Cerrar sesión en todos mis equipos» (Mi perfil → Contraseña) y «Cerrar sus sesiones» (Equipo). Claves en el nuevo `i18n/parts/sessions.js`. | `src/lib/session-control.ts`, `staff-scope.ts`, `staff-guard.ts`, `staff-roles.ts`, `staff-profile-data.ts`, `audit.ts`, `api/middlewares.ts`, rutas nuevas, `StaffProfile.jsx`, `Team.jsx`, `adminTeam.js`; tests `session-control.test.ts`, `staff-guard.test.ts` |
| Costes de proveedor fuera del bundle público | `enrichProducts` ya no pone `supplierPrice`/`markup` en los objetos de producto; `supplierPriceFor` se exporta y la pestaña Precios lo calcula ella misma. En esta rama el costo contable ya venía del servidor (`/admin/pricing/frames/costs`), así que ninguna otra pantalla lo leía (comprobado con grep y con el build: `supplierPrice` no aparece en `dist/`). | `src/data/products.js`, `AdminDashboard.jsx`, `docs/SEGURIDAD-PRECIOS.md` |
| Accesibilidad | `aria-label` en los campos del checkout (el del correo usa `auth.email`, porque el placeholder es una dirección de ejemplo); `--adm-faint` a 4,7:1 (claro) / 6,1:1 (oscuro); objetivos de 44 px bajo `pointer: coarse` a través del token `--adm-ctl-h`; `<input type=file>` de `.pos-file` oculto visualmente pero enfocable, con anillo de foco en la etiqueta. | `MedusaCheckout.jsx`, `admin.css` |
| SEO | `scripts/gen-seo.mjs` genera `robots.txt` y `sitemap.xml` en cada build (añade también los 28 estuches `/estuche/…`); `public/robots.txt` versionado, `sitemap.xml` ignorado; `Organization` JSON-LD en `index.html`; hook en `apps/capri-storefront/scripts/vercel-build.sh`. | `apps/capri-storefront/scripts/`, `public/robots.txt`, `index.html`, `.gitignore` |
| `vercel.json` duplicado | Eliminados `vercel.json` y `scripts/vercel-build.sh` de la raíz (habían divergido: sin rewrite de staging, otro `buildCommand`, menos cabeceras); `check-vercel-config.mjs` falla si reaparece cualquiera de los dos; `CLAUDE.md` actualizado. | raíz, `scripts/check-vercel-config.mjs`, `CLAUDE.md` |
| CI | PRs hacia `develop_optical_storepos` también corren los checks; `backend-boot` compila con `medusa build` antes de migrar; `deploy` necesita `check-config` y `backend-boot`. | `.github/workflows/ci.yml` |
| Estado de las migraciones | `docker-entrypoint.sh` deja `MEDUSA_MIGRATE_STATUS`; `GET /version` expone `migrations`; `security-status` añade `db.migrations_applied` y la pestaña Seguridad lo pinta (etiqueta/ayuda en `i18n/parts/security-extra.js`; `Security.jsx` ya resuelve cualquier clave nueva). | `docker-entrypoint.sh`, `api/version/route.ts`, `lib/security.ts`, `tests/security.test.ts` |
| Insignia «Consumo IA» | Deja de sondear `/admin/ai-usage/status` al primer 404. | `AdminDashboard.jsx` |
| `ADMIN_PANEL_URL` | `adminPanelUrl()` en `password-reset.ts`: el enlace de recuperación prefiere `ADMIN_PANEL_URL` (p. ej. `https://opticaelrancho.com/admin`) y si no `STOREFRONT_URL/admin`. Documentado en `.env.example` (junto con los dos límites de recuperación) y `docs/ADMIN-PANEL.md`. | `src/lib/password-reset.ts`, `tests/password-reset.test.ts` |
| `.gitignore` / `CLAUDE.md` | `sitemap.xml` ignorado; párrafos de contraseñas y sesiones, fechas del POS y `vercel.json` reescritos sobre los nuestros. | raíz |

## Cómo se comprobó (5-nov-2026)

- `apps/backend`: `tsc --noEmit`, `eslint src tests` (0 errores), `jest --runInBand`: **67 suites / 1188 tests** en verde (antes 64 / 1157).
- `node scripts/check-i18n.mjs` (5.470 claves × 2), `node scripts/check-vercel-config.mjs`.
- `apps/capri-storefront`: `vite build` en verde; `supplierPrice` ausente del bundle.

## Pendiente (sigue siendo decisión del dueño o trabajo mayor)

Lo que la auditoría dejaba en su punto 5 sigue igual: promover a producción por
PR, redesplegar `api-staging`, datos de Op2/Op3, venta transaccional con
compensación, precios solo desde el servidor (`VITE_USE_MEDUSA`, ver
`docs/SEGURIDAD-PRECIOS.md`) y los módulos parciales (M5, M6, M8, M11, M15, M17).
Al desplegar este estado hay que correr la migración `StaffProfileSessions5`
(la hace `db:migrate` al arrancar; `GET /version` dirá si falló).
