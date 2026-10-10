# Deploying the accounting backend

This service (`backend/`) is the staff admin API. It owns the shared
database's migrations (it runs `alembic upgrade head` on startup), product
photo uploads, and order administration. Deploy it **before** the storefront
API whenever a release adds a migration — the storefront only checks the
schema revision (`EXPECTED_SCHEMA_REVISION` in ecobel-website).

## Supabase Data API

Neither service uses Supabase's Data API (PostgREST): both backends connect
to PostgreSQL as the table owner, and the frontends only call the backends.
Every table in `public` therefore has row-level security on with **no
policies** (migration `0005_data_api_lockdown` closed the last six), so the
`anon`/`authenticated` API roles can't read or write anything. A **new
table** added by a future migration must enable RLS too — Supabase grants the
API roles full privileges on new tables by default. Check after each
migration: Supabase advisor "RLS Disabled in Public", or
`python ops/demo_reset/check_api_roles.py`.

## Start command (behind a hosting proxy)

```
uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10"
```

Behind a load balancer every request arrives from the balancer's address.
Without `--proxy-headers` all staff would share one sign-in rate limit, so a
few wrong passwords from anyone would lock everyone out for a minute. Only
private/internal ranges are trusted as proxies: uvicorn then takes the
address the platform appended to `X-Forwarded-For` (walking the list from
the right), and a client can't fake its address by sending its own header.
Never use `--forwarded-allow-ips="*"` — uvicorn would then trust the
leftmost entry, which the client controls.
`tests/test_staff_login.py` runs the real uvicorn proxy middleware with the
ranges written above and checks this behaviour.

Run **one instance with one worker**: the per-minute request limiter keeps
its counters in process memory. Failed sign-ins per username are counted in
the database (`auth_throttle`) and hold across processes.

After deploying, check the access log: your own requests must show your
public IP. If they show a private address, the platform's proxy is outside
these ranges — adjust `--forwarded-allow-ips` to it (still never `*`).

## Environment variables (names only — never commit values)

| Name | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Shared Supabase PostgreSQL (Session pooler URL). Same database as ecobel-website. |
| `SECRET_KEY` | Yes | Signs staff tokens; 32+ random characters, different from the storefront's. |
| `FRONTEND_ORIGINS` | Yes | The admin frontend's https origin(s), comma-separated. |
| `ENVIRONMENT` | Yes | `production` — hides `/docs`, adds HSTS, refuses unsafe settings at startup. |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_SECRET_KEY` | Yes | Server-only Storage key for photo uploads (never in the frontend). |
| `PRODUCT_IMAGES_BUCKET`, `PRODUCT_IMAGE_BASE_URL` | No | Storage bucket / public base URL overrides. |
| `STAFF_LOGIN_MAX_FAILURES` | No | Failed sign-ins per username before a pause (default 10). |
| `STAFF_LOGIN_FAILURE_WINDOW_MINUTES` | No | Counting window (default 15). |
| `STAFF_LOGIN_BLOCK_MINUTES` | No | Pause length (default 15). |

## Staff accounts

Create staff with `python create_admin.py <username>` (prompts for the
password; new passwords need at least 8 characters — existing staff sign in
as before).
