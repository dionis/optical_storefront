# Registro de operaciones (operation log)

Pedido del dueño (15-nov-2026): «guardar el log de todas las operaciones que se
hagan en la base de datos con lujo de detalles para auditoría […] un clic ordena
ascendente/descendente, doble clic busca un dato de esa columna […] solo en
super admin […] exportar e imprimir en PDF según intervalo de tiempo, tienda,
etc.».

## Qué se guarda

Cada `INSERT`, `UPDATE`, `DELETE` y `TRUNCATE` sobre las tablas del negocio deja
una fila en `operation_log`, escrita por un **disparador de PostgreSQL dentro de
la misma transacción** del cambio (migración
`src/modules/audit/migrations/CreateOperationLog2.ts`):

| Columna | Qué es |
|---|---|
| `seq` | número correlativo (orden real de escritura) |
| `at` | `clock_timestamp()` del momento exacto |
| `txid` | transacción de PostgreSQL (agrupa lo que se escribió junto) |
| `table_name`, `op`, `row_id` | tabla, operación y `id` de la fila |
| `establishment_id` | tienda, si la fila la tiene (si no, la pantalla la toma de otra fila de la misma petición) |
| `changed` | columnas tocadas (en un `UPDATE`, solo las que cambiaron) |
| `before`, `after` | valores antes y después (en un `UPDATE`, solo las columnas cambiadas) |
| `actor_id`, `actor_type`, `actor_role` | quién (usuario del panel o paciente de la web) y con qué rol |
| `source` | `panel` · `store` (tienda web) · `auth` · `api` · `system` |
| `request_id`, `method`, `route`, `ip`, `user_agent` | la petición HTTP (el id también sale en la cabecera `x-request-id`) |
| `db_user` | usuario de PostgreSQL |

Reglas del disparador:

- Un `UPDATE` que solo movió `updated_at` no es una operación y no se registra.
- `deleted_at` puesto → `SOFT_DELETE`; quitado → `RESTORE`.
- **Secretos**: una columna cuyo nombre parece clave/contraseña/token/hash/salt/
  api key/cvv/número de tarjeta guarda `"[redacted]"`.
- **Salud**: de `prescription` solo se guarda QUÉ campos cambiaron; los valores
  de la graduación quedan como `"[health data]"`.
- Un valor de más de 2.000 caracteres se guarda como `{"_truncated": n}`.
- Si el disparador no puede leer la etiqueta de la petición, la escritura sigue
  y se registra como `system` (nunca bloquea una venta).

Tablas que NO se registran (`oplog_skip_tables()`): el propio registro y
`audit_event`, la proyección de los tableros (`sale_fact`), la maquinaria de
Medusa (`workflow_execution`, migraciones), autenticación (`auth_*`,
`provider_identity`, `api_key`), carritos de la web y sesiones de pago (mucho
tráfico, nada contable), `notification`, `ai_usage_event`, `order_summary`.

## Quién y desde dónde

`src/lib/operation-log-context.ts`:

1. `opContextMiddleware` (en `/*`, justo después de `securityHeaders`) abre un
   `AsyncLocalStorage` con la petición (id, método, ruta sin query, IP —primer
   salto de `X-Forwarded-For`—, navegador, origen).
2. La persona se añade sola en cuanto Medusa la autentica (`req.auth_context`),
   y `staffGuard` pone el rol (`setOpActor`).
3. Se envuelve `_query` del cliente PostgreSQL de knex **en su prototipo** (así
   lo usan todas las conexiones y transacciones de todos los módulos) y a cada
   `insert/update/delete/with` escrito dentro de una petición se le antepone
   `/*oplog:<base64url JSON>*/`. El disparador lo lee con `current_query()`
   (y lo cachea por sentencia: una escritura masiva no lo vuelve a decodificar).

base64url solo tiene letras, dígitos, `-` y `_`: nada que pueda cerrar el
comentario ni tocar la sentencia.

Escrituras fuera de una petición (jobs, `medusa exec`, migraciones, psql) se
registran igual, como `system`.

## Integridad

`operation_log` es de solo inserción: un disparador `BEFORE UPDATE/DELETE/
TRUNCATE` lo impide. Solo el job de retención borra, diciendo
`SET LOCAL oplog.purge = 'on'` dentro de su transacción. (Un superusuario de la
base de datos siempre puede desactivar disparadores; eso queda fuera del
alcance de la aplicación.)

## Mantenimiento

Job `operation-log-maintain` (cada hora, minuto 35): `SELECT oplog_attach_all()`
pone el disparador en cualquier tabla nueva (creada por una migración
posterior). Con `OPLOG_RETENTION_DAYS` (≥ 90) en Coolify borra lo más viejo en
lotes de 5.000; **sin la variable no se borra nunca nada**.

Volumen: una venta de caja deja ~20 filas (venta, pagos, pedido, líneas, caja…).
`price-sync` ya no reescribe los precios que no cambiaron (antes, cada 4 h,
borraba e insertaba cada precio del catálogo).

## Leerlo

- `GET /admin/operation-log?from&to&store&table&op&actor&source&q&col[<col>]&sort&dir&page&limit&export=1`
  (solo dueño y superadmin: la ruta no está en la lista de los roles
  restringidos). Columnas: `at, store, actor, role, source, op, table, row,
  changed, route, ip, request, data`. `col[x]=a|b` = cualquiera de los dos.
  Página máx. 200; exportación máx. 5.000. Intervalo máx. 366 días.
- `GET /admin/operation-log/:seq` — la fila con `before/after` completos y las
  demás filas de la misma transacción.
- Pantalla: Administración → **Registro de operaciones** (`OperationLog.jsx`).
  Clic en un encabezado ordena (asc/desc); doble clic (o la lupa, en tableta)
  busca en esa columna; Operación/Origen/Rol/Tabla se buscan también por su
  nombre en pantalla («Cambio» → `UPDATE`, «Paciente» → `customer`). La tienda y
  el período son los de la barra de filtros (más la hora de inicio/fin), y la
  barra exporta PDF (apaisado, con la cabecera de los informes), Excel y CSV.

## Pruebas

`tests/operation-log.test.ts` (etiqueta, contexto, limpieza del filtro,
resumen). QA local contra PostgreSQL: venta y corrección de pagos registradas
con persona/rol/ruta/IP, recetas sin valores, tokens ocultos, solo-inserción,
vendedor rechazado (403), filtros, orden, búsqueda por columna, exportación.
