# Eco Bel — Accounting & Inventory System (Backend)

FastAPI + SQLAlchemy backend covering: single-warehouse inventory tracking,
B2B wholesale sales with automatic per-customer discounts, free sample
distribution, finance entries (income/expense), and reports. Single user
role — anyone logged in has full access (per current project scope).

## Setup

```bash
python -m venv venv
source venv/bin/activate        # venv\Scripts\activate on Windows
pip install -r requirements.txt

cp .env.example .env            # then edit DATABASE_URL / SECRET_KEY
```

For local development without PostgreSQL installed, just leave
`DATABASE_URL` unset — it falls back to a local SQLite file automatically.
For production, point `DATABASE_URL` at your PostgreSQL instance.

Create the database schema (via Alembic — see below), then create the
first (and only, for now) user (you'll be prompted for the password):

```bash
alembic upgrade head
python create_admin.py admin
```

Optionally seed sample data (3 categories, 20 products, and ~18 months of
simulated B2B sales history) for demos/testing:

```bash
python seed_data.py
```

Run the server:

```bash
uvicorn app.main:app --reload
```

Interactive API docs: http://localhost:8000/docs

## Database — no separate migration step

Schema is created on startup (`Base.metadata.create_all` in `app/main.py`)
— no Alembic, no `alembic upgrade` to remember to run. `create_all` only
creates tables that don't exist yet and never touches or drops existing
ones, so it's safe to run every time the app starts, even against a
database that already has real data.

Adding a new column to an existing table (like `Product.image_url`) needs
one more step, since `create_all` can't alter a table that's already
there: add an entry to `_COLUMNS_TO_ENSURE` in `app/schema_sync.py`, and
`ensure_columns()` (also called on startup, right after `create_all`)
adds it via `ALTER TABLE` the first time the app runs against a database
created before that column existed — defensively, skipping any column
that's already present.

## Sharing a database with ecobel-website

[ecobel-website](https://github.com/Mosapmohamd/ecobel-website) shares
this database — same `DATABASE_URL` in both `.env` files:

- **This service owns and manages**: `categories`, `products` (incl.
  `image_url`), `inventory_movements`, `finance_entries`, plus its own
  B2B/free-distribution tables — and now also admin actions on the
  website's tables (see below).
- **The website writes to, but doesn't manage**: `customers`, `coupons`,
  `orders`, `order_items`. It creates rows here at checkout/registration
  and validates coupons, but all *administration* of these — coupon
  CRUD, online-order status updates, sales analytics — lives in this
  service's API (`/coupons`, `/online-orders`, `/sales-analytics`) and
  its admin dashboard, not in the website.

Both services' `models.py` define the shared tables identically —
mirror any change on both sides.

**Local development**: point both services' `DATABASE_URL` at the same
database — a shared PostgreSQL/Supabase instance, or for quick local
testing, one shared SQLite file (absolute path, so it resolves the same
regardless of which repo's folder you run from):

```bash
# in both backend/.env files:
DATABASE_URL=sqlite:////absolute/path/to/a/shared/ecobel_shared_dev.db
```

Start either service first — `create_all` makes every table each service
knows about, and running the other afterward just fills in the rest
(nothing gets touched twice).

## Project layout

```
app/
  main.py            FastAPI app, router wiring, CORS
  database.py         SQLAlchemy engine/session (Postgres or SQLite)
  models.py            ORM models — products, inventory movements, B2B
                        customers/orders, free distributions, finance
  schemas.py           Pydantic request/response models
  auth.py               JWT login + current-user dependency
  services.py           Shared stock-movement logic (keeps Product.quantity
                        in sync with InventoryMovement rows)
  routers/
    auth_router.py     POST /auth/login
    categories.py         /categories — dynamic product categories (list/create)
    products.py         /products — CRUD (rejects duplicate name+category)
    inventory.py         /inventory — manual restock/adjustment, movement log
    b2b.py                 /b2b/customers, /b2b/orders — automatic discount
                          calculation, stock deduction, auto finance entry
    free_distribution.py /free-distribution — sample tracking, stock deduction,
                          no revenue
    finance.py            /finance/entries — manual income/expense entries
    reports.py             /reports/dashboard, /reports/monthly-sales
alembic/
  env.py               Migration environment — wired to app.models + DATABASE_URL
  versions/            Migration scripts (generated via `alembic revision --autogenerate`)
```

## Key business rules encoded here

- **Inventory is append-only**: every stock change (restock, B2B sale, free
  distribution, manual adjustment) creates an `InventoryMovement` row.
  `Product.quantity` is a cache kept in sync by `services.apply_stock_movement`,
  so the movement log is always the audit trail of *why* stock changed.
- **B2B discount is never entered manually per order** — it's read from
  `B2BCustomer.discount_percentage` (fixed, pre-agreed) and applied
  automatically when an order is created.
- **A B2B order automatically creates a `FinanceEntry`** (category "مبيعات
  جملة B2B") — no separate manual bookkeeping step needed.
- **Free distribution has no revenue** — it only moves stock out and is
  visible in inventory reports, not sales reports.
- **Products are soft-deleted** (`is_active = False`), never hard-deleted,
  since past order items and movements reference them.
- **No two active products can share the same name within the same
  category** — enforced on both create and edit.

## Security notes

- **`SECRET_KEY` is required outside local SQLite dev** — if `DATABASE_URL`
  points at a real database and `SECRET_KEY` isn't set, the app refuses to
  start rather than silently signing tokens with a guessable default.
- **`/auth/login` is rate-limited** to 5 attempts/minute per IP (via
  `slowapi`) to slow down credential brute-forcing.
- **CORS is restricted** to `FRONTEND_ORIGINS` (comma-separated env var,
  defaults to the local Vite dev server only) instead of `*`.
- **Numeric inputs are bounds-checked** at the schema level: discounts are
  0–100%, prices/quantities/amounts can't be negative or zero where that
  wouldn't make sense (e.g. a finance entry amount, an order line quantity).
- **`create_admin.py` prompts for the password** instead of taking it as a
  plain CLI argument, so it doesn't end up in shell history or `ps` output.
- **List endpoints cap their page size** (`/inventory/movements` limit ≤
  500, `/reports/monthly-sales` months ≤ 36) to avoid unbounded queries.

## Online store admin (coupons, online orders, sales analytics)

```
GET    /coupons/                       list coupons
POST   /coupons/                       create — limit_type: duration | count | unlimited
PATCH  /coupons/{id}                   edit (can switch limit_type too)
POST   /coupons/{id}/renew             reset used_count to 0, reactivate
DELETE /coupons/{id}

GET    /online-orders/?status=...      website (b2c) orders
PATCH  /online-orders/{id}/status      pending -> shipped -> delivered / cancelled

GET    /sales-analytics/?source=all|online|b2b
       total_revenue, total_orders, orders_by_status, 30-day revenue
       series, top-5 products by quantity — online and B2B orders live in
       separate tables (orders vs b2b_orders) and stay that way; this
       endpoint only combines them in the response.

POST   /products/{id}/image            upload a product photo (jpg/png/webp,
                                        <=5MB), served from /static
```

## Not yet wired up (future work)

- Product images are stored locally under `static/` — moving them to
  Supabase Storage is planned so they aren't tied to wherever this
  service happens to be deployed (and so image traffic doesn't compete
  with this service's own workload).
- Multi-warehouse support — intentionally out of scope; current schema
  assumes a single stock pool per the client's current operations.
