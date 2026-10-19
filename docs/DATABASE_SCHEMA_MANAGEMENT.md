# Database schema management

The shared EcoBel database (Supabase project, PostgreSQL) is used by both
this service and ecobel-website. **Supabase is the only authority for its
schema.** Neither application creates, alters or migrates anything — not on
startup, not in scripts. Schema changes are explicit, reviewed SQL, applied
in Supabase by a person.

## What the applications do with the schema

- **Startup:** nothing that changes it. Each backend runs one read-only check
  (`check_schema_matches_models` in `backend/app/database.py`) that logs a
  warning if the database lacks a table or column its models use. It never
  blocks startup and never fixes anything.
- **Models** (`backend/app/models.py`, mirrored in ecobel-website for the
  shared tables) describe what the code expects. They are not a schema
  source: a model change does nothing to the database by itself.
- **Tests** build a throwaway SQLite database from the models
  (`tests/conftest.py` here; each test module in ecobel-website). That is
  test-only and refuses to run against anything but SQLite.
- `create_admin.py` and `seed_data.py` expect the schema to exist already.

## Changing the schema

1. **Write the SQL.** One file per change under `docs/schema-changes/`,
   named `YYYY-MM-DD_short_name.sql`: the forward statements, wrapped in
   `BEGIN; … COMMIT;`, and the rollback as comments. Keep it additive when you
   can (new nullable column, new table, new index), so the running code keeps
   working before and after.
2. **Change the models to match** — here, and in ecobel-website if it maps the
   table (the shared models must stay identical). Same pull request(s) as the
   SQL file.
3. **Every new table needs row-level security.** Supabase grants its Data API
   roles (`anon`, `authenticated`) full privileges on new tables by default.
   Add `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;` (no policies:
   the backends connect as the table owner and are unaffected; no frontend
   uses the Data API).
4. **Review** the SQL and model diff together before anything is applied.
5. **Apply** in the Supabase Dashboard → SQL Editor (or `psql` with the
   project's connection string, kept out of shell history), as one
   transaction. Apply before deploying code that needs the change; when
   removing something, deploy the code that no longer uses it first.
6. **Verify:**
   - both backends start without a "schema lacks …" warning;
   - `python -m pytest` passes in both repositories;
   - `python ops/demo_reset/check_api_roles.py` reports `EXPOSED operations: 0`,
     and the Supabase security advisor shows no "RLS Disabled in Public";
   - the storefront and admin flows touched by the change work.

Never apply schema changes from application code, and never "fix" a mismatch
by calling `create_all` against Supabase.

## Setting up another environment

Take the schema from Supabase, not from the models:
`pg_dump --schema-only --schema=public` against the project (or the Supabase
CLI's `supabase db dump`), reviewed, then applied to the new project. Check
RLS afterwards as in step 6.

## History: the `alembic_version` table

Until 2026-10 the schema was managed by Alembic migrations in this
repository. They were removed; the database keeps their result. Applied, in
order:

| Revision | What it did |
|---|---|
| `0001_baseline` | the schema as it existed before migrations |
| `0002_integrity` | NOT NULL / constraint fixes, legacy value cleanup |
| `0003_product_image_key` | `products.image_key` |
| `0004_abuse_controls` | `orders.client_ip_hash` (+ index), `auth_throttle` table |
| `0005_data_api_lockdown` | RLS on every public table; no API-role privileges on `alembic_version`, `auth_throttle` — SQL kept in [`schema-changes/2026-10-10_data_api_lockdown.sql`](./schema-changes/2026-10-10_data_api_lockdown.sql) |

The live database still has the `alembic_version` table recording
`0005_data_api_lockdown`. Nothing reads or writes it any more; it stays as
historical metadata, with RLS on and no API access. Don't change or drop it
as part of routine work — that would be a separate, reviewed schema change.
(`ops/demo_reset` reads it only to report and to check it's unchanged.)

`products.image_url` exists in the live database but in no model; it was
added outside these repositories. Leave it until its origin is confirmed.
`staff_users` is a legacy table no model uses.
