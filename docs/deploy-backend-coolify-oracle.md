# Backend deployment: Coolify on Oracle Cloud Free Tier

Status: **work in progress / dev-test setup**. This documents the current state
and what's still needed before this is a real production deployment.

## Architecture decision

Only the **Medusa backend** runs on the VPS via Coolify. Everything else uses
managed free tiers:

| Component | Where | Why |
|---|---|---|
| Backend (Medusa v2) | Coolify app, Oracle VM | Persistent Node process, needs a real server |
| Postgres | Supabase (free tier) | Managed backups, no need to self-host DB |
| Redis | Coolify service, same VM | Lightweight, cheap to self-host, avoids another signup |
| Meilisearch | Coolify service, same VM | Same as Redis |
| Storefront | Vercel | Already deployed there (see recent commits) |

This differs from the original `infra/docker-compose.prod.yml` plan (everything
self-hosted on one Hetzner VPS). That compose file still exists and works if
we ever want to go back to a fully self-hosted stack, but it is **not** what's
currently deployed.

## Oracle Cloud VM

- Always Free tier, Ampere (ARM) `VM.Standard.A1.Flex`, Ubuntu 22.04.
- Public IP: **reserved** (not ephemeral) — `161.153.9.98`.
  - Reserved via Networking → IP Management → Reserved Public IPs.
  - Assigned to the instance's VNIC via Attached VNICs → IP administration →
    edit the private IP → switch Public IP type from Ephemeral to Reserved.
  - Ephemeral IPs are **not guaranteed** to survive a stop/start — always use
    reserved for anything long-lived.

### Networking gotchas hit during setup

1. **Public IPv4 assignment must be toggled on** during instance creation, and
   the subnet must actually be public (has a route to an Internet Gateway).
   Creating the VCN inline in the instance-launch wizard was flaky — creating
   it separately via **Networking → Virtual Cloud Networks → Start VCN
   Wizard → "Create VCN with Internet Connectivity"** is more reliable
   (auto-configures IGW, NAT gateway, route tables, security lists).
2. Two independent firewall layers must both allow traffic — missing either
   one blocks the connection with no obvious error on the other side:
   - **OCI Security List** (subnet-level, in the console).
   - **iptables inside the VM** (Oracle's Ubuntu images ship with a
     restrictive default policy).
3. Reserved Public IPs are **not** assigned from their own resource page in
   this Coolify/Oracle console version (no "Assign" action there) — they're
   attached from the **instance's VNIC → IP administration → Edit** on the
   private IP, switching "Public IP type" to Reserved.

### Security List — ingress rules currently open

| Source | Protocol | Port | Purpose |
|---|---|---|---|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 80 | HTTP / Let's Encrypt challenge |
| `0.0.0.0/0` | TCP | 443 | HTTPS |
| `0.0.0.0/0` | TCP | 8000 | Coolify dashboard (installer UI) |

No NSG (Network Security Group) is attached to the VNIC — only the Security
List applies.

### iptables — must mirror the rules above

```bash
sudo iptables -I INPUT -p tcp --dport 8000 -j ACCEPT
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
sudo netfilter-persistent save
```

Verify order with `sudo iptables -L INPUT -n --line-numbers` — ACCEPT rules
must appear **before** the trailing `REJECT` rule, or they're never reached.

## Coolify

Installed via the official script:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

Dashboard: `http://161.153.9.98:8000` (installer/admin UI — separate from any
app domains below).

Project structure: `optical-storefront` project → `production` environment →
resources for the backend app, Redis service, Meilisearch service.

## Supabase (Postgres)

Use the **Session Pooler** connection string, not Direct and not Transaction
Pooler:

| Connection type | Port | IPv4 reachable | Works for Medusa migrations |
|---|---|---|---|
| Direct (`db.<ref>.supabase.co`) | 5432 | ❌ IPv6-only unless paid add-on | N/A — unreachable from this VM |
| **Session Pooler** (`aws-0-<region>.pooler.supabase.com`) | 5432 | ✅ | ✅ — supports prepared statements |
| Transaction Pooler (same host) | 6543 | ✅ | ❌ — PgBouncer transaction mode breaks prepared statements Medusa/MikroORM needs |

```
DATABASE_URL=postgres://postgres.<project-ref>:[password]@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

Note the username format: `postgres.<project-ref>`, not just `postgres`
(that's the Direct-connection username).

## Backend Dockerfile

`apps/backend/Dockerfile` was added (didn't exist before). Key points:

- **Build context must be the repo root**, not `apps/backend` — the build
  needs `pnpm-workspace.yaml` and `packages/shared`.
  - Coolify: Build Pack = `Dockerfile`, Base Directory = `/`,
    Dockerfile Location = `apps/backend/Dockerfile`.
- Multi-stage: installs the full pnpm workspace, builds `@eyewear/shared`
  then `@eyewear/backend`, and runs `pnpm start` from `apps/backend` keeping
  the full monorepo `node_modules` (rather than Medusa's usual standalone
  `.medusa/server` + reinstall) — this avoids `@eyewear/shared` being
  referenced via an unresolvable `workspace:*` protocol outside the monorepo.
- **Not yet validated with a real `docker build`** (Docker Desktop wasn't
  running locally when this was written) — first Coolify deploy is the real
  test. If `pnpm start` doesn't pick up the Medusa build output correctly,
  the `CMD` may need to change to explicitly run from `.medusa/server`.
- `.dockerignore` added at repo root (excludes `node_modules`, `dist`,
  `.medusa`, `.next`, `.git`, `.env*`, `infra`, `apps/scraper`,
  `apps/storefront` from the build context).

## Environment variables (Coolify → backend app → Environment Variables)

```
DATABASE_URL=<Supabase Session Pooler string>
REDIS_URL=redis://<internal-coolify-redis-service-name>:6379
MEILISEARCH_HOST=http://<internal-coolify-meilisearch-service-name>:7700
MEILISEARCH_MASTER_KEY=<generated>
JWT_SECRET=<random>
COOKIE_SECRET=<random>
NODE_ENV=production

# Public URLs — see "BACKEND_URL" note below. Currently http:// (see Domain section).
BACKEND_URL=http://<backend-domain>
ADMIN_CORS=http://<backend-domain>
AUTH_CORS=http://<backend-domain>
STORE_CORS=https://<storefront-vercel-domain>
```

Plus R2, Stripe, PayPal, Square, Anthropic, Resend keys per
`apps/backend/.env.example`.

### Why `REDIS_URL`/`MEILISEARCH_HOST` are internal but `BACKEND_URL` is not

- `REDIS_URL` and `MEILISEARCH_HOST` are container-to-container calls inside
  Coolify's Docker network → use the internal service hostnames Coolify
  assigns.
- `BACKEND_URL` (`medusa-config.ts` → `admin.backendUrl`) is fetched **by the
  browser** running the Medusa Admin panel, and is also used for
  Stripe/PayPal webhook callbacks. It must be a publicly resolvable URL, never
  an internal Docker hostname — the browser/external services can't resolve
  those.

## Domain / SSL — current blocker

No owned domain yet. Using **sslip.io** (`<label>.<ip-with-dots-or-dashes>.sslip.io`)
as a free wildcard-DNS workaround that resolves to `161.153.9.98` without any
registration.

**Problem hit:** requesting HTTPS on a `sslip.io` domain in Coolify triggers:

> sslip domain with https is NOT recommended, because Let's Encrypt servers
> with this public domain are rate limited (SSL certificate validation will
> fail)

This is a shared-domain rate limit on Let's Encrypt's side (sslip.io is used
by many people), not something fixable from our side.

**Current workaround:** domain set to `http://` (no SSL) for the dev/test
phase. `BACKEND_URL`, `ADMIN_CORS`, `AUTH_CORS` all set to match, over plain
HTTP.

## What's required before real production

- [ ] **Buy a real domain** (~$10-15/yr, e.g. Porkbun/Namecheap/Cloudflare
      Registrar). Avoid `.dev`/`.app` TLDs if any interim HTTP testing is
      still needed — those force HTTPS via browser HSTS preload lists.
- [ ] Point an A record at `161.153.9.98`, switch the Coolify domain to
      `https://`, let Coolify/Let's Encrypt issue a real certificate.
- [ ] Update `BACKEND_URL`, `ADMIN_CORS`, `AUTH_CORS` to the final `https://`
      domain.
- [ ] Confirm `STORE_CORS` includes the final Vercel production domain (and
      custom domain, if any).
- [ ] Switch Stripe/PayPal/Square from sandbox/test keys to live keys, and
      re-register webhook endpoints against the final HTTPS backend URL
      (most providers reject non-HTTPS webhook URLs, and sandbox webhook
      secrets differ from live ones).
- [ ] Validate the Docker build actually succeeds end-to-end in Coolify
      (first real deploy) — see the Dockerfile caveat above.
- [ ] Wire up the CI auto-deploy: in Coolify → backend app → Webhooks, copy
      the URL, then add `COOLIFY_WEBHOOK_URL` and `COOLIFY_WEBHOOK_TOKEN` as
      GitHub Actions secrets (`infra/github-actions/ci.yml` already has the
      `deploy` job wired to these).
- [ ] Enable at least one Coolify notification channel (dashboard currently
      shows "No notifications enabled") so failed deploys/health checks
      actually alert someone.
- [ ] Decide fate of `infra/docker-compose.prod.yml` (self-hosted Postgres +
      storefront) — either delete it or clearly mark it as an
      alternative/legacy path, since it no longer matches what's deployed.
