# Eco Bel — Accounting & Inventory System

Internal admin dashboard for Eco Bel (Egyptian skincare/haircare brand).
Owns and manages the shared database used by
[ecobel-website](https://github.com/Mosapmohamd/ecobel-website) (same
Supabase/PostgreSQL instance) — this is where all admin actions for both
the internal business and the public storefront happen.

- [`backend/`](./backend) — FastAPI + SQLAlchemy API (see its README for setup)
- [`frontend/`](./frontend) — React + TypeScript + Vite dashboard

Both are versioned together here since they ship as one product and are
always deployed in lockstep.

## What's built

**Inventory & B2B**
- Single-warehouse product/category management, stock adjustments, low-
  stock tracking
- B2B wholesale orders: multiple items per order, a customer's standing
  discount plus an optional one-time extra discount entered manually
  per order (never saved back to the customer), expandable order detail
- Free sample distribution tracking

**Finance**
- Split into three views — website revenue, B2B revenue, general
  spendings — backed by a `source` tag on every entry rather than
  guessing from free-text categories
- Website order cancellation (customer- or staff-initiated) automatically
  reverses the recorded revenue and releases the reserved stock
- Reports section with real `.xlsx` exports (finance by source, online
  orders, B2B orders, inventory) — not CSV-pretending-to-be-Excel

**Online store admin** (المتجر الإلكتروني) — everything the website
itself doesn't manage:
- Online (website) orders: status updates, full detail view (customer,
  address, items, city)
- Offers — single-product discounts shown on the website's homepage
- Routines — curated 2–3 product bundles
- Coupons — percentage/fixed, duration- or count-limited
- Shipping rates — delivery fee per city, which drives the website
  checkout's city dropdown directly
- Review moderation — approve or delete customer reviews before they
  reach the public product page
- Unified sales analytics — combined or filtered to online-only /
  B2B-only, without merging the two order tables together

**Design**
- Same rose/blush rebrand and real Eco Bel logo as the website, so the
  dashboard and the storefront it manages look like one product

## Shared database

No Alembic — `Base.metadata.create_all` on startup creates anything
missing, and a small `schema_sync` helper handles adding columns to
existing tables and normalizing legacy data values. See
[`backend/README.md`](./backend/README.md) for the full explanation and
for exactly which tables this service owns versus which ones the
website writes to directly.
