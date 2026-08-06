# Nota para Dionis — Precios de cristales (CSV RUBILENT)

_Daniel pidió mapear el CSV `precios_cristales_rubilent.csv` como **precios de venta final**, y **quitar los materiales 1.56 y 1.61**._

## Lo que YA cambié (en develop)

- **Matriz base de precios** (diseño × material) actualizada a los valores del CSV, en:
  - Frontend (respaldo/vista): `apps/capri-storefront/src/data/lensPricing.js` → `MATERIALS` y `BASE`.
  - Backend (semilla / fuente de verdad): `apps/backend/src/scripts/seed-lens-2026.ts` → `MATERIALS` y `BASE_USD`.
- **Materiales 1.56 y 1.61 eliminados** de ambos (quedan cr39, poly, 1.67, 1.74).
- No toqué la estructura de opciones ni el resto de módulos ("sin desconfigurar").

## Lo que TÚ tienes que hacer para que el precio real cambie en producción

El precio de verdad lo calcula el backend desde las tablas `lens_*`. Para aplicarlo:

1. **Desplegar backend**: `git checkout main && git merge develop && git push origin main` (Coolify redespliega). *(A mí el clasificador me bloquea el push a main.)*
2. **Re-sembrar la matriz** en el backend ya desplegado:
   ```
   medusa exec src/scripts/seed-lens-2026.ts
   ```
   Esto **borra y reinserta** las 5 tablas de la matriz (design/material/base/photo/ar) con los valores nuevos y sin 1.56/1.61. No afecta pedidos existentes.

## Decisión pendiente (te la dejo a ti) — tratamientos AR y Fotocromático

El CSV cobra **AR Green, AR Blue y Fotocromático variando por material y por gama** (Visión Sencilla varía por material; Media ≠ Alta). El modelo actual **no** guarda ese detalle: AR es un precio plano por grupo (sv/bifprog) y el fotocromático es por categoría (sv/bifocal/prog, con prog-mid y prog-high compartiendo "prog").

Por eso **no cambié los precios de AR/foto** (habría quedado inconsistente o habría que tocar el modelo). Dos caminos:

- **A (fiel):** añadir precio por (diseño × material) para AR y foto (tabla nueva o columnas) + migración + ajustar `lens-quote.ts`. Es lo correcto para reflejar el CSV exacto.
- **B (rápido):** consolidar a lo del CSV (AR Green/Blue + un solo "Fotocromático") con un precio representativo por gama, aceptando perder la variación por material.

Valores del CSV para cuando decidamos (USD):
- **AR Green** — sv: 20/20/35/35 · bifocal 36 · prog-mid 36 · prog-high 36
- **AR Blue** — sv: 35/35/42/45 · bifocal 72 · prog-mid 72 · prog-high 72
- **Fotocromático** — sv: 42/46/76/80 · bifocal 85 · prog-mid 44/55/68/68 · prog-high 45/45/73/73
- (orden material: cr39, poly, 1.67, 1.74)

Cuando me digas A o B lo implemento.
