# Supabase — `rls_disabled_in_public` y `sensitive_columns_exposed`

## Diagnóstico

Supabase se usa en este proyecto **únicamente como Postgres gestionado**. El backend
se conecta por `DATABASE_URL` directo (puerto 5432, no el pooler) y las imágenes salen
de Supabase Storage por la API S3. **No hay `supabase-js` en ninguna app** — ni en el
backend, ni en el storefront, ni en el scraper.

Aun así, Supabase expone el esquema `public` a través del **Data API (PostgREST)** por
defecto. Medusa crea todas sus tablas en `public`, así que PostgREST está publicando
tablas que nadie pidió publicar:

| Tabla | Por qué la marca el linter |
|---|---|
| `prescription` | Graduaciones (PHI) + `customer_id` + `file_url` de la receta |
| `customer` | Email, teléfono, nombre |
| `order_address` | Dirección postal y teléfono del paciente |
| `user` | Emails de administradores |
| `auth_identity` / `provider_identity` | Material de credenciales en `provider_metadata` |

Los dos avisos son la misma causa vista dos veces: `rls_disabled_in_public` dice que las
tablas están expuestas sin RLS, `sensitive_columns_exposed` señala cuáles de ellas tienen
columnas sensibles.

**Alcance real del riesgo.** Para leer por PostgREST hace falta la *anon key* además de la
URL del proyecto. La URL sí es pública — está en el bundle del storefront, en la base de
assets `https://<ref>.supabase.co/storage/v1/object/public/eyewear-assets`. La anon key no
aparece en ningún build. Así que no hay exposición activa, pero la anon key es publicable
por diseño y un solo descuido la convierte en pública; el aviso hay que cerrarlo igual.

## Por qué NO escribimos políticas RLS

Es lo que sugiere el propio aviso, y es la respuesta equivocada aquí:

- Son ~200 tablas que no son nuestras, sino de Medusa.
- **Cada migración de Medusa crea tablas nuevas sin RLS**, así que el aviso reaparecería
  en cada deploy y habría que reejecutar el script indefinidamente.
- No ganamos nada: no hay ningún cliente que deba leer estas tablas con la anon key. La
  política que queremos no es "quién puede ver qué fila", es "nadie entra por ahí".

## Arreglo

### 1. Apagar el Data API (el arreglo principal)

Dashboard → **Project Settings → Data API** → desactivar el Data API, o dejarlo activo y
quitar `public` de *Exposed schemas*.

Esto **no rompe nada de lo que usamos**:

- `DATABASE_URL` es una conexión Postgres directa, no pasa por PostgREST.
- Supabase Storage (`storage-api`) y Auth son servicios aparte con sus propios endpoints;
  la carga de imágenes por S3 y la URL pública de assets siguen igual.

Tras el cambio, comprobar que el storefront sigue sirviendo imágenes y que el backend
arranca y lee pedidos.

### 2. Revocar los grants (el respaldo)

Ejecutar [`apps/backend/scripts/supabase-lockdown.sql`](../apps/backend/scripts/supabase-lockdown.sql)
en el SQL Editor. Quita `usage` sobre `public` a `anon` y `authenticated`, y — lo más
importante — corrige los **default privileges** de Supabase, que autoconceden acceso a
esos dos roles sobre cualquier objeto nuevo del esquema. Sin ese paso, el siguiente
`medusa db:migrate` volvería a exponer sus tablas nuevas.

Es la capa que sobrevive a que alguien reactive el toggle del paso 1 más adelante.

### 3. Rotar la anon key (opcional pero recomendable)

Con el Data API apagado la anon key ya no abre nada, pero si se sospecha que circuló
fuera del equipo: Project Settings → API → *Rotate*. No hay que actualizar ningún `.env`
de este repo, porque ninguna app la usa.

### 4. Si el aviso persiste en el dashboard

El linter debería dejar de disparar al no estar `public` expuesto. Si el badge sigue en
rojo y se quiere en verde, está
[`apps/backend/scripts/supabase-enable-rls.sql`](../apps/backend/scripts/supabase-enable-rls.sql):
activa RLS sin políticas en todas las tablas de `public`.

Leer la advertencia que lleva dentro. Es seguro **solo** porque el rol de `DATABASE_URL`
(`postgres`) es el dueño de las tablas y los dueños se saltan RLS mientras no se active
`FORCE ROW LEVEL SECURITY`. Si algún día `DATABASE_URL` apunta a un rol que no es dueño,
Medusa empezará a ver tablas vacías. Y hay que reejecutarlo tras cada migración.

## Verificación (ejecutada contra la base de producción)

Comprobado con `has_table_privilege()`, que es la consulta autoritativa porque tiene en
cuenta los permisos concedidos al pseudo-rol `PUBLIC` y la herencia de roles — cosa que
`information_schema.role_table_grants` no muestra bajo el grantee `anon`:

| Comprobación | Resultado |
|---|---|
| Tablas de `public` legibles por `anon` | **0 de 155** |
| Tablas de `public` legibles por `authenticated` | **0 de 155** |
| Vistas / vistas materializadas en `public` | 0 (no hay ninguna) |
| Secuencias accesibles por `anon` | 0 de 8 |
| Permisos concedidos al pseudo-rol `PUBLIC` sobre tablas | ninguno |
| Roles de los que `anon` hereda | ninguno |
| Tabla nueva creada por el rol de migración | `anon` no recibe ningún permiso |

Esa última fila es la que garantiza que el aviso no vuelve: se creó una tabla en `public`
como el rol de `DATABASE_URL` dentro de una transacción con `rollback`, y `anon` no obtuvo
permisos sobre ella. Los *default privileges* de `postgres` en `public` están limpios.

Dos matices que la verificación sacó a la luz y conviene conocer:

- **`anon` conserva `USAGE` sobre el esquema `public`**, y no se puede quitar con
  `revoke ... from anon`: viene de un permiso al pseudo-rol `PUBLIC` (`=U/pg_database_owner`),
  que es el valor por defecto de Postgres 15. No importa — `USAGE` solo permite resolver
  nombres dentro del esquema, y sin permisos sobre los objetos no hay nada que resolver.
- **Los *default privileges* de `supabase_admin` siguen concediendo a `anon`/`authenticated`.**
  `postgres` no es miembro de `supabase_admin`, así que no se pueden tocar desde el SQL
  Editor. Es inofensivo: se aplican a lo que cree `supabase_admin`, y las migraciones de
  Medusa corren como `postgres`.

Conviene repetir la verificación **después de un upgrade de Postgres en Supabase**, que es
el escenario en el que la plataforma podría reaplicar sus grants por defecto.

`anon` sí conserva acceso a relaciones en los esquemas `storage` (7), `extensions` (2) y
`realtime` (2). Es lo esperado y no se toca: son los esquemas propios de Supabase, con su
propio RLS, y `storage` debe seguir funcionando para el bucket público de assets.

## Desactivar el Data API: por qué no rompe nada

El toggle **Enable Data API** controla **solo PostgREST** (`/rest/v1`) y las librerías cliente
de Supabase. No toca Postgres, ni Storage, ni Auth, ni Realtime, que son servicios aparte.

De Supabase usamos exactamente dos cosas, y **ninguna pasa por el Data API**:

| Servicio | Cómo se accede | ¿Afectado? |
|---|---|---|
| Postgres | `DATABASE_URL`, pooler puerto 5432, driver `pg` | No |
| Storage | protocolo S3 (`R2_ENDPOINT`) + URL pública (`R2_PUBLIC_URL`) | No |

**Ojo con los nombres de variables**: los `R2_*` son un resto histórico de Cloudflare R2 —
hoy apuntan a **Supabase Storage** (`svuuuobjgrkscsjgpwkx.storage.supabase.co`). Quien lea
`R2_BUCKET` y asuma Cloudflare se va a equivocar al razonar sobre qué depende de Supabase.

No hay ninguna dependencia `@supabase/supabase-js` (ni `postgrest-js`, `storage-js`,
`auth-js`, `realtime-js`) en el monorepo, ni ninguna variable `SUPABASE_URL` /
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` en ningún `.env`. Las únicas menciones a
Supabase en el código son comentarios sobre compatibilidad S3.

Comprobado en vivo **después** de desactivar el toggle:

- Conexión Postgres y lecturas reales de Medusa: OK (600 productos, 24 pedidos, 43 recetas, 2 admins)
- `ListObjects` firmado sobre `eyewear-assets` y `eyewear-prescriptions`: OK
- Imagen pública `eyewear-assets/healthcheck.txt`: HTTP 200
- Bucket de recetas por la ruta pública sin firmar: denegado (`NoSuchBucket`) — el PHI sigue solo tras URL firmada

Lo único que se pierde es la sección autogenerada de *API Docs* del dashboard. El Table
Editor y el SQL Editor siguen funcionando: van por una ruta privilegiada, no por PostgREST.

## Lo que este arreglo no cubre

Cerrar el Data API protege el acceso *por la API de Supabase*. Sigue siendo cierto que:

- El bucket público de assets (`eyewear-assets`) es público a propósito. El de recetas
  (`R2_PRESCRIPTION_BUCKET`) debe seguir privado — ver [SECURITY.md](../SECURITY.md).
- La contraseña de `DATABASE_URL` sigue siendo la llave del reino. Vive en el almacén
  cifrado de Coolify y no se commitea.
