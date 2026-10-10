# EcoBel demo reset

Replaces the business data in the shared Supabase database with a small,
coherent demo dataset — safely: verified backup first, one transaction, full
validation, automatic rollback on any failure.

**Target:** Supabase project `oelhvhwagfrmodhqpxxf` ("EcoBel", eu-west-1,
PostgreSQL 17.6), database `postgres`, via the session pooler in
`backend/.env` → `DATABASE_URL`. Every script refuses any other remote target;
`--dsn` / `--local-url` / `--admin-dsn` accept only `127.0.0.1`/`localhost`.

These scripts live outside `backend/` on purpose: a `uvicorn --reload` dev
server watching `backend/` is not restarted by editing them.

## Files

| File | Writes to Supabase? | Purpose |
|---|---|---|
| `backup.py` | no (read-only snapshot) | `pg_dump` (full, public, Supabase metadata) + `manifest.json` (row counts, content md5 per table, schema facts, sha256 per file) |
| `verify_restore.py` | no | restores `public.dump` into a **new database on an isolated local PostgreSQL 17** and compares everything with the manifest |
| `reset_seed.py` | **yes** (only with `--execute`) | reset + seed in one transaction; dry run by default |
| `rls_hardening.sql` | **yes** | separate security change: RLS on the 6 exposed tables |
| `check_api_roles.py` | no (probes roll back) | what `anon`/`authenticated` can do on those tables |
| `common.py` | — | shared helpers; never prints the connection string |

PostgreSQL 17 client/server tools: the official EDB portable zip
(`postgresql-17.6-1-windows-x64-binaries.zip`, sha256
`d378882abd001a186735acd6f6ba716bca6ccd192e800412d4fd15ed25376b3e`), unzipped
anywhere; pass its `pgsql/bin` as `--pgbin`. Isolated cluster used for
verification (local user process, 127.0.0.1 only):

```
initdb -D <dir> -U pgsuper -E UTF8 --locale=C --auth=trust
# postgresql.conf: listen_addresses='127.0.0.1', port=55432
pg_ctl -D <dir> -l <log> start
psql -h 127.0.0.1 -p 55432 -U pgsuper -d postgres \
  -c "CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB CREATEROLE BYPASSRLS" \
  -c "CREATE ROLE anon NOLOGIN" -c "CREATE ROLE authenticated NOLOGIN" \
  -c "CREATE ROLE service_role NOLOGIN BYPASSRLS" -c "GRANT anon, authenticated TO postgres"
```

## Procedure (in this order — stop at the first failure)

```
cd ecobel-accounting-system/ops/demo_reset
# 1. fresh backup (outside Git; folder ACL restricted to the current user)
python backup.py --pgbin <bin> --out D:/Projects/EcoBel/db-backups
# 2. prove it restores — must end with "RESTORE VERIFIED"
python verify_restore.py --pgbin <bin> --backup D:/Projects/EcoBel/db-backups/<stamp> --admin-dsn "host=127.0.0.1 port=55432 user=pgsuper dbname=postgres"
# 3. dry run, then the real run (aborts if ANY table changed since the backup)
python reset_seed.py --mode reset-seed --expect-manifest D:/Projects/EcoBel/db-backups/<stamp>/manifest.json
python reset_seed.py --mode reset-seed --expect-manifest D:/Projects/EcoBel/db-backups/<stamp>/manifest.json --execute
# 4. idempotency — must insert 0 rows
python reset_seed.py --mode seed --execute
# 5. security (separate change), then confirm "EXPOSED operations: 0"
psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -f rls_hardening.sql
python check_api_roles.py
# 6. post-reset backup + verify (the new recovery point)
```

## What the reset does

One transaction: `LOCK TABLE` (ACCESS EXCLUSIVE) on all 24 public tables →
content checksums must equal the backup manifest → `DELETE`s children before
parents (no `TRUNCATE … CASCADE`), each must remove exactly the counted rows →
seed inserts → validations → `COMMIT` only with `--execute`.

**Cleared:** featured_products, featured_routines, reviews, routine_items,
order_items, inventory_movements, finance_entries, free_distribution_items,
free_distributions, b2b_order_items, b2b_orders, b2b_customers, offers, orders,
coupons, routines, guest customers (`hashed_password IS NULL`), products,
categories, auth_throttle.

**Preserved unchanged** (checksum-verified inside the transaction): `users`
(staff logins + hashes), `staff_users` (unmanaged legacy), `alembic_version`,
`shipping_rates` (27 governorates, active ones used by the demo checkout),
customer **login accounts** (customers with a password; their old orders and
review are removed with the rest), the schema (incl. `products.image_url`),
Supabase Storage and Auth.

**Seeded** (ids `seed_*`, re-runnable with `--mode seed`):

| Table | Rows | Content |
|---|---|---|
| categories | 2 | العناية بالبشرة، العناية بالشعر |
| products | 4 | SKUs `ECO-DEMO-001…004`, opening stock 50 each via `restock` movements |
| offers | 2 | serum 320→270 (through 31 Dec 2026, Cairo), shampoo 210→175 (through 30 Nov 2026) |
| coupons | 2 | `WELCOME10` 10 %, min 300, max 100 uses, used once · `SAVE50` 50 EGP, min 500, through 31 Dec 2026, unused |
| customers | 2 | guest profiles `01000000001`, `01000000002` (test numbers, no other personal data) |
| orders / order_items | 2 / 4 | `EBDEMXSEEDA2` delivered (750 − 75 coupon + 50 shipping = 725) · `EBDEMXSEEDB3` pending (355 + 50 = 405) |
| b2b_customers / b2b_orders / items | 2 / 2 / 3 | 15 % and 10 % (+5 % one-off) discounts: 1 377 and 1 071 EGP |
| inventory_movements | 11 | 4 opening restocks, 4 website_sale, 3 b2b_sale → stock 44 / 49 / 45 / 43 |
| finance_entries | 4 | one income per order (website / b2b), amounts = order totals |
| routines / routine_items | 2 / 3 | روتين البشرة اليومي (2 products), روتين الشعر الجاف (1) |
| featured_products / featured_routines | 3 / 1 | serum, moisturiser, shampoo / skin routine |

Values follow the apps' rules (website `pricing`/`checkout`/`routers/orders.py`,
accounting `routers/b2b.py`, `services.apply_stock_movement`, offer end =
next Cairo midnight). Rehearsal proved it: the live `/cart/quote` returns
exactly the seeded orders' subtotal/discount/shipping/total.

**Validated before commit:** no orphan on any FK · every seed row present ·
exact table counts · stock = Σ movements, never negative · order and line
arithmetic · one sale movement per line · one income entry per order equal to
its total · coupon `used_count` = live orders using it · B2B totals, movements
and income · at most one active offer per product, below its price · featured
items sellable · order cities have an active rate · preserved tables and
migration revision unchanged.

## Recovery

* Failure before `COMMIT` → automatic rollback; nothing changes.
* After `COMMIT` → restore the pre-reset backup (stop both backends first):
  ```
  psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -c "BEGIN; DROP SCHEMA public CASCADE; COMMIT;"   # only public, never auth/storage
  pg_restore --exit-on-error --single-transaction --no-owner -d "<DATABASE_URL>" <stamp>/public.dump
  ```
  then compare with `<stamp>/manifest.json` (same checksums as
  `verify_restore.py`). Supabase grants come back from the dump's ACLs; check
  `check_api_roles.py` and the Supabase security advisor afterwards.
