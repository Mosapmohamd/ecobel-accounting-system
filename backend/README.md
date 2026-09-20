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

Create the first (and only, for now) user:

```bash
python create_admin.py admin "your-password"
```

Optionally seed sample data (2 categories + 10 products) for demos/testing:

```bash
python seed_data.py
```

Run the server:

```bash
uvicorn app.main:app --reload
```

Interactive API docs: http://localhost:8000/docs

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
    products.py         /products — CRUD
    inventory.py         /inventory — manual restock/adjustment, movement log
    b2b.py                 /b2b/customers, /b2b/orders — automatic discount
                          calculation, stock deduction, auto finance entry
    free_distribution.py /free-distribution — sample tracking, stock deduction,
                          no revenue
    finance.py            /finance/entries — manual income/expense entries
    reports.py             /reports/dashboard, /reports/monthly-sales
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

## Not yet wired up (future work)

- Website integration for `website_sale` movements / income entries — the
  model and movement type already exist, ready for Phase 1 (the e-commerce
  site) to call into once it's built.
- Multi-warehouse support — intentionally out of scope; current schema
  assumes a single stock pool per the client's current operations.
