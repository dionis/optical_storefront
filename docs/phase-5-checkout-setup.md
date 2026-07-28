# Phase 5 — Checkout backend (provisioned & validated)

Status: **backend checkout works end-to-end** (validated via curl, 2026-07-28). The
remaining work is the storefront integration (Medusa cart in `CartContext` + Stripe.js
in the browser). Payment: **Stripe** primary, multi-gateway kept in `medusa-config.ts`.

## What was provisioned (live Medusa on Supabase)

| Resource | Value / note |
|---|---|
| Region (USD) | `reg_01KYGQPN0TF6ZS1G2GN0ENY28R` (country `us`) |
| Payment provider on region | **`pp_stripe_stripe`** enabled (needs `STRIPE_SECRET_KEY` in backend `.env`) |
| Sales channel | `sc_01KY7DC5TWQAAMEKWB7G8C5QS3` |
| Publishable key (SPA) | `pk_133b…` (bound to the sales channel) |
| Stock location | `sloc_01KYM9CS26WM4YXWFXRTWEB79T` — Óptica El Rancho (Fry Rd, Katy) |
| Fulfillment provider | `manual_manual` (linked to the location) |
| Fulfillment set / service zone | `fuset_01KYM9CZ06YVS3ZXBCTGQ3SGRQ` / US zone `serzo_01KYMD7EWD…` |
| Shipping profile | `sp_01KY7ASCJRHGF1BK8Y030AZV8Y` (default) |
| Shipping options | "Recoger en tienda" ($0) · "Envío estándar" ($6.95) |

## Validated flow (Store API, publishable key)

```
POST /store/carts                 { region_id, email, items:[{variant_id, quantity}] }
POST /store/carts/:id             { shipping_address }
GET  /store/shipping-options?cart_id=:id
POST /store/carts/:id/shipping-methods   { option_id }
POST /store/payment-collections          { cart_id }
POST /store/payment-collections/:id/payment-sessions  { provider_id: "pp_stripe_stripe" }
   → payment_session.data.client_secret = "pi_…"   ← Stripe PaymentIntent, drives Stripe.js
POST /store/carts/:id/complete    → order   (after the browser confirms the card)
```

Smoke test result: frame $99 + shipping $6.95 → cart total **$105.95**, Stripe session
`pending`, amount 105.95, real `client_secret`. Prices are **decimal dollars** (Medusa v2
convention) — never cents — throughout carts/products.

## Remaining (storefront)

1. **Cart:** `src/data/medusaCart.js` (SDK-based create/add/address/shipping/payment) +
   rewrite `CartContext` to use it under `USE_MEDUSA` (persist only `cart_id`).
2. **Lens add-on in cart:** see the open decision below (custom line item vs lens products).
3. **Checkout UI:** mount Stripe.js with `VITE_STRIPE_PUBLISHABLE_KEY`, confirm the card
   with the `client_secret`, then `POST /store/carts/:id/complete`.
4. **Provider switch:** `VITE_DEFAULT_PAYMENT_PROVIDER=stripe` (change to paypal/square
   without code edits, given their keys).
5. **Webhooks (optional):** `STRIPE_WEBHOOK_SECRET` + `stripe listen` for signature-verified
   order finalization; not required for the initial browser test.

## Open decision — lens add-on pricing in the cart

Store carts reject client-set prices, so the lens cost ($60–$300 from `/quote`) must be
added server-side. Two approaches (pick one):

- **A — Custom line item via a server route.** A new `POST /store/…/lens-line` runs the
  existing `computeQuote` and adds a cart line item with the server-computed lens price +
  `metadata` (lens_config, prescription_id). Reuses the 2026 matrix as the single source of
  truth; no duplicate catalog. Recommended.
- **B — Lens products/variants.** Seed real Medusa products/variants for each design×material
  (+ photo/AR) and add them as normal line items. Fully native (taxes/discounts/admin-edit),
  but duplicates the matrix and needs ~38 variants + code↔variant mapping.
