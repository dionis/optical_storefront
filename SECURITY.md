# Security Policy

## Prescription data

Prescription records contain protected health information (PHI). The following controls are in place:

- The R2 bucket storing prescription images (`prescriptions/`) is **private**. Access is exclusively via presigned URLs with short TTL (15 minutes).
- All admin API routes that read prescription records emit structured audit log entries (user ID, timestamp, action).
- A data-deletion endpoint (`DELETE /admin/prescriptions/:id`) is provided for GDPR/CCPA compliance. It removes both the database record and the R2 object.

## Secrets management

- No credentials are committed to this repository. Every secret is injected via environment variables.
- `.env.example` files in each app list all required variables with descriptions but no real values.
- Production secrets are managed in Coolify's encrypted environment store.

## Reporting vulnerabilities

Please open a **private** GitHub Security Advisory rather than a public issue.
