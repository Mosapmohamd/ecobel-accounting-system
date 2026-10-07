# EcoBel Development Phases — Admin/Accounting (ecobel-accounting-system)

The EcoBel system is two repositories sharing one PostgreSQL (Supabase)
database: `ecobel-website` (storefront) and this admin/accounting system
(React + Vite frontend, FastAPI backend). **This repository owns the shared
database's migration history.** This file records what each phase
delivered **in this repository**.

## How this history is committed

Phases 1–4 were developed as uncommitted work and checkpointed together in
**one commit** (see *Checkpoint commit* below). Exact per-phase commits
could not be reconstructed safely (files changed by several phases, script
edits without intermediate snapshots), so the phases are described here
instead of inventing a history.

---

## Phase 1 — Design system & homepage

No functional changes in this repository: Phase 1 was storefront work.

## Phase 2 — Merchandising

**Objective:** staff decide exactly which products and routines the
storefront homepage features, and in what order.

**Scope / major changes**
- Tables `featured_products` (positions 1–8) and `featured_routines`
  (positions 1–2): position is the primary key, one slot per item, checks on
  the position range, cascade on delete.
- `app/routers/merchandising.py`: get/replace each selection in one
  transaction; only active, in-stock items; no duplicates; within limits.
- Admin page **واجهة المتجر** (`MerchandisingPage.tsx`): add, remove,
  reorder, save/undo, flags items no longer shown on the site.
- One active offer per product; deleting a routine frees its slot.

**Testing:** `tests/test_merchandising.py`; end-to-end admin → storefront
checks.

## Phase 3 — Commerce lifecycle

**Objective:** consistent order handling between storefront and admin.

**Scope / major changes**
- Online-order status lifecycle: pending → shipped/cancelled, shipped →
  delivered/cancelled; delivered and cancelled are final. The API returns
  `next_statuses`; cancelling releases stock, the coupon use and the revenue.
- Admin order page: one button per allowed step, each confirmed in-app.
- Every `alert()`/`confirm()` replaced by `ConfirmDialog` / `useConfirm`;
  `apiErrorMessage` helper.

**Phase 1–3 fix batch (after the Phase 1–3 audit, before Phase 4)**
- **Migration baseline (Alembic):** one history for the shared database —
  `0001_baseline` (the schema exactly as it existed) and `0002_integrity`
  (unique order numbers, coupon codes and usernames; customer phone index;
  one account and one guest profile per phone; NOT NULL
  `extra_discount_percentage`; the former `schema_sync.py` data fixes).
  Applied on startup by `app/migrations.py`; `schema_sync.py` removed.
- Enum columns declared as VARCHAR (`native_enum=False`) to match the live
  schema; guest profiles and accounts modelled as separate identities.

**Testing:** `tests/test_online_orders.py`, `tests/test_schema.py`
(migrations must equal the models; constraints enforced).

## Phase 4 — Product image management

**Objective:** a reliable photo workflow for staff, served to the storefront
from Supabase Storage.

**Supabase Storage architecture**
- Bucket `product-images`: public read, 5 MB limit, JPG/PNG/WebP only.
  Created/updated automatically on first upload.
- Only this backend writes, with `SUPABASE_SECRET_KEY` (server only; public
  "publishable"/anon keys are refused).
- Object keys `products/<product_id>/<random>.<ext>` — unique per upload,
  never overwritten, cached for one year.

**Database migration:** `0003_product_image_key` renames
`products.image_url` → `image_key` (non-key legacy values cleared — none
existed). Both services expose `image_url` as the public URL built from the
key.

**API:** `POST /products/{id}/image` (validate → upload → point product at
new key → delete old object), `DELETE /products/{id}/image`. Staff only.
503 when storage isn't configured, 502 when storage fails.

**Security / validation:** declared type, extension and real format must
agree; at most 5 MB read; every pixel decoded (corrupt files rejected);
over 40 MP rejected (decompression bombs); animated images, GIF/SVG and
images under 200 px rejected. The old local `/static` mount was removed.

**Image lifecycle:** upload → replace (old object deleted) → remove (key
cleared, object deleted). `python -m app.product_images orphans [--delete]`
lists/removes stored files no product references.

**Admin UI:** image manager (`ProductImageManager.tsx`) with current-photo
and local preview, upload/replace with loading state, removal behind
`ConfirmDialog`, Arabic inline errors, success toasts (`Toast.tsx`,
`lib/toast.ts`, built from the existing admin colours).

**Testing:** `tests/test_product_images.py` (formats, rejections,
replace/remove, storage failure, staff-only access, orphan finder, exact
Supabase API requests); end-to-end against real Supabase Storage.

---

## Verified results at this checkpoint

| Check | Result |
|---|---|
| Backend tests (`cd backend && python -m pytest -q`) | 40 passed |
| Frontend type-check / build | pass / pass |
| Frontend lint (`npm run lint`) | 0 errors, 13 pre-existing warnings |
| End-to-end: admin 23/23, real Supabase image lifecycle 22/23* |  |

\* See the storefront's `docs/PHASES.md`: the CDN keeps a deleted photo
cached for up to ~65 s; the object itself is deleted at once.

The end-to-end suites are Playwright scripts that were run against isolated
throwaway databases; they are not part of this repository.

## Known open items (not part of Phases 1–4)

- `SECRET_KEY`: the currently configured development value also appears in
  this repository's history — use a new random value before any non-local
  deployment.
- Imported development order/finance data (M7) is inconsistent — owner
  decision whether to reseed or reconcile.
- Admin lint warnings, unused imports in `reports.py`/`report_exports.py`.

## Checkpoint commit

`fb7b4f5` — *feat: EcoBel Phases 1-4 checkpoint* (Phases 1, 2, 3 incl. the fix batch, and 4, plus the earlier uncommitted pre-Phase-1 work). Branch `phase-1-4-final`.

## Current status

- Phase 1: COMPLETE (no changes needed here)
- Phase 2: COMPLETE
- Phase 3: COMPLETE
- Phase 4: COMPLETE
- Phase 5: NOT STARTED
