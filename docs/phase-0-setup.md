# Phase 0 — Backend setup (owner runbook)

The code side of Phase 0 (SDK client, feature flag, env docs) is done in the repo.
This document lists the steps that **require a running Medusa backend** and must be
performed by the owner against the live instance. Targets Medusa **v2.8.x**.

Prereqs: the backend boots (`pnpm --filter @eyewear/backend dev`) with a valid
`DATABASE_URL`, and you can reach the admin dashboard at
`http://localhost:9000/app` (or your deployed backend `/app`).

---

## a) Create a sales channel

The storefront sells through exactly one sales channel; the publishable key is
scoped to it. A fresh Medusa project seeded with `pnpm --filter @eyewear/backend
seed` already has a **"Default Sales Channel"** — you can reuse it and skip creation.

**Admin dashboard**
1. Go to **Settings → Sales Channels**.
2. Click **Create** (or open the existing "Default Sales Channel").
3. Name it e.g. `Capri Storefront`. Save.
4. Note its ID (`sc_...`), shown in the URL / details panel.

**Admin API (alternative)**
```bash
curl -X POST http://localhost:9000/admin/sales-channels \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Capri Storefront" }'
```
(Get `<ADMIN_JWT>` via `POST /auth/user/emailpass` with your admin credentials.)

---

## b) Create a publishable API key and associate the sales channel

The storefront authenticates every Store API request with this key (header
`x-publishable-api-key`, handled automatically by `@medusajs/js-sdk`). The key
value is prefixed `pk_...` and is safe to expose in the browser bundle.

**Admin dashboard**
1. Go to **Settings → Publishable API Keys**.
2. Click **Create**. Name it e.g. `Capri Storefront (web)`. Save.
3. Open the key, go to its **Sales Channels** tab, and **add** the sales channel
   from step (a). This link is required — without it, `store.product.list()`
   returns nothing / errors.
4. Copy the key token (`pk_...`).

**Admin API (alternative)**
```bash
# 1. Create the publishable key
curl -X POST http://localhost:9000/admin/api-keys \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{ "title": "Capri Storefront (web)", "type": "publishable" }'
# → returns { api_key: { id: "apk_...", token: "pk_...", ... } }

# 2. Associate the sales channel with the key
curl -X POST http://localhost:9000/admin/api-keys/<apk_id>/sales-channels \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{ "add": ["<sc_id>"] }'
```

---

## c) Put the values into the `.env` files

### Storefront — `apps/capri-storefront/.env` (copy from `.env.example`)
```bash
VITE_MEDUSA_URL=http://localhost:9000            # deployed backend URL in prod
VITE_MEDUSA_PUBLISHABLE_KEY=pk_...               # token from step (b)
VITE_USE_MEDUSA=false                            # flip to true per-page in later phases
```

### Backend — `apps/backend/.env` (copy from `.env.example`)
`STORE_CORS` must include the storefront origin(s), or the browser blocks Store
API calls. `medusa-config.ts` already reads `process.env.STORE_CORS`.
```bash
# dev SPA runs on port 5198; add the Vercel domain for prod
STORE_CORS=http://localhost:5198,https://your-storefront.vercel.app
```
Restart the backend after changing `STORE_CORS`.

---

## Verify (once both are running)

1. Backend up with the new `STORE_CORS`; storefront `.env` filled in.
2. Quick check the key + CORS from the SPA origin:
   ```bash
   curl -i http://localhost:9000/store/products \
     -H "x-publishable-api-key: pk_..." \
     -H "Origin: http://localhost:5198"
   ```
   Expect `200` and an `access-control-allow-origin` header echoing the origin.
   A `400`/`401` about a missing/invalid publishable key means step (b) or the
   sales-channel association is incomplete. (The product list can legitimately be
   empty until the catalog is populated in Phase 1.)
3. In the browser, `medusa.store.product.list()` from `src/data/medusa.js` should
   resolve without a CORS error.
