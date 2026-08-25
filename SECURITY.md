# Security Policy

## Prescription data

Prescription records contain protected health information (PHI). The following controls are in place:

- The bucket storing prescription files (`R2_PRESCRIPTION_BUCKET`) is **private** and separate from the public assets bucket. Objects are never given a public ACL, so access is exclusively via presigned URLs with a short TTL (15 minutes, `PRESCRIPTION_URL_TTL_SECONDS`). `GET /admin/prescriptions/:id` mints one as `file_download_url`.
- A presigned URL is a **bearer credential**: anyone holding it can fetch the file until it expires, with no further authentication. It must never be logged, emailed, or persisted, and it cannot be revoked early — deleting the object is the only way to invalidate one before its TTL runs out.
- All admin API routes that read prescription records emit structured audit log entries (user ID, timestamp, action). Note the limitation: because the file is fetched from object storage directly, the audit trail records that a download link was **issued**, not that the file was opened. Attributing actual views would require proxying the download through the backend.
- A data-deletion endpoint (`DELETE /admin/prescriptions/:id`) is provided for GDPR/CCPA compliance. It removes both the database record and the stored object.

## Database exposure (Supabase)

Supabase is used as managed Postgres only — the backend connects directly over `DATABASE_URL` and no app in this repo uses `supabase-js`. Supabase nevertheless publishes the `public` schema through its PostgREST Data API by default, and Medusa creates every table there, including `prescription`, `customer`, `order_address` and `auth_identity`. The Data API must therefore stay **disabled** on the project, with `anon`/`authenticated` revoked from the `public` schema (including Supabase's default privileges, which would otherwise re-grant access to each new table a migration creates). See [docs/supabase-security-hardening.md](docs/supabase-security-hardening.md) and the scripts in `apps/backend/scripts/`.

## Secrets management

- No credentials are committed to this repository. Every secret is injected via environment variables.
- `.env.example` files in each app list all required variables with descriptions but no real values.
- Production secrets are managed in Coolify's encrypted environment store.

## Reporting vulnerabilities

Please open a **private** GitHub Security Advisory rather than a public issue.
