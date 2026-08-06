# Nota para Dionis — Precios de cristales (CSV RUBILENT)

_Precios de **venta final** del listado RUBILENT, y **sin** 1.56/1.61._

## Cómo quedó (sin hardcode, fuente de verdad = BD del backend)

- **Migración nueva** `apps/backend/src/modules/lens-config/migrations/UpdateLensPricesRubilent5.ts`:
  actualiza `lens_base_price` a los precios de venta y elimina los materiales **1.56 y 1.61**.
- **Dockerfile**: ahora el contenedor corre `medusa db:migrate` **antes** de `medusa start`,
  así esta migración (y las futuras) se aplican **solas en cada deploy**. `db:migrate` es idempotente.
- Frontend (`lensPricing.js`) y `seed-lens-2026.ts` también actualizados para quedar consistentes
  (el frontend es solo respaldo; la tienda lee los precios de la BD del backend).

## Lo único que falta (yo estoy bloqueado para hacerlo)

**Desplegar `main`** (a mí el clasificador me bloquea el push a `main`):
```
git checkout main && git merge develop && git push origin main
```
Al redesplegar, el contenedor corre las migraciones y **los precios cambian solos**. No hay que correr ningún seed a mano.

Matriz base aplicada (USD): SV 24/30/52/95 · Bifocal 47/55/160/180 · Prog. Media 75/75/131/145 · Prog. Alta 101/101/135/135 (orden cr39, poly, 1.67, 1.74).

## Pendiente de decisión — AR y Fotocromático

El CSV cobra AR Green/Blue y Fotocromático **variando por material y por gama**, que el modelo actual (AR plano por grupo, foto por categoría) no representa. No los toqué para no romper nada. Si quieres reflejarlos exactos hay que añadir precio por (diseño × material) para AR/foto (tabla o columnas). Valores del CSV:
- **AR Green** — sv 20/20/35/35 · bifocal 36 · prog-mid 36 · prog-high 36
- **AR Blue** — sv 35/35/42/45 · bifocal 72 · prog-mid 72 · prog-high 72
- **Fotocromático** — sv 42/46/76/80 · bifocal 85 · prog-mid 44/55/68/68 · prog-high 45/45/73/73
