# Deploying the accounting backend

This service (`backend/`) is the staff admin API: product photo uploads,
order administration, reports. It never changes the database schema — that's
managed in Supabase with reviewed SQL ([`DATABASE_SCHEMA_MANAGEMENT.md`](./DATABASE_SCHEMA_MANAGEMENT.md)).
When a release needs a schema change, apply its SQL in Supabase **before**
deploying either backend; on startup each backend logs a warning if the
database lacks something its models use.

## SECRET_KEY

Signs staff login tokens (and keys the sign-in throttle). Give this service
its **own** random value — never the storefront's — e.g.
`python -c "import secrets; print(secrets.token_urlsafe(48))"`. Tokens it
issues carry `"type": "staff"` and nothing else is accepted, but separate
keys keep a leak in one service from reaching the other. Production refuses
to start with a key known to be published (`app/security.py`). Changing the
key signs every staff member out (they sign in again); throttle counters
restart, which is harmless.

## Supabase Data API

Neither service uses Supabase's Data API (PostgREST): both backends connect
to PostgreSQL as the table owner, and the frontends only call the backends.
Every table in `public` therefore has row-level security on with **no
policies** (the 2026-10-10 change in `schema-changes/` closed the last six), so the
`anon`/`authenticated` API roles can't read or write anything. A **new
table** added later must enable RLS in its SQL too — Supabase grants the
API roles full privileges on new tables by default. Check after each
schema change: Supabase advisor "RLS Disabled in Public", or
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
