-- 2026-10-27 — Audit trail of staff status changes on website orders.
-- STATUS: applied to the shared Supabase project on 2026-10-27 (after review
-- and owner approval; table, constraints, RLS and privileges verified; no
-- existing row changed). The accounting API's order status change
-- (PATCH /online-orders/{id}/status) needs it: every change is recorded here
-- in the same transaction.
--
-- Additive: one new append-only table; no existing table or row changes.
--   * order_status_changes — one row per status change made by staff:
--       from_status → to_status, the staff username, when, and what the
--       change did: revenue_change (+ recognized / − reversed, 0 if none)
--       and units_restored (stock given back on cancellation).
--
-- Security: RLS on, no policies, no Data API privileges — like the other
-- recent tables (promotions); both backends connect as the table owner.
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_status_changes (
    id              varchar PRIMARY KEY,
    order_id        varchar NOT NULL REFERENCES public.orders (id),
    from_status     varchar NOT NULL CHECK (from_status IN ('pending', 'shipped', 'delivered', 'cancelled')),
    to_status       varchar NOT NULL CHECK (to_status IN ('pending', 'shipped', 'delivered', 'cancelled')),
    changed_by      varchar NOT NULL,
    revenue_change  double precision NOT NULL DEFAULT 0,
    units_restored  integer NOT NULL DEFAULT 0 CHECK (units_restored >= 0),
    created_at      timestamptz DEFAULT now(),
    CONSTRAINT ck_order_status_changes_moves CHECK (from_status <> to_status)
);
CREATE INDEX IF NOT EXISTS ix_order_status_changes_order_id ON public.order_status_changes (order_id);

ALTER TABLE public.order_status_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_status_changes FROM anon, authenticated;

COMMIT;
