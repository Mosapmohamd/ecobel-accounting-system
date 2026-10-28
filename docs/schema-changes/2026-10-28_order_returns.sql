-- 2026-10-28 — Customer returns on website orders (partial or full).
-- STATUS: applied to the shared Supabase project on 2026-10-28 (after review
-- and owner approval; tables, constraints, indexes, RLS and privileges
-- verified; no existing row changed). The accounting API's returns endpoints
-- (/online-orders/{id}/returns…) and the delivered→cancelled check need it.
--
-- Additive: two new append-only tables; no existing table, column or row
-- changes. (Restocked units are inventory_movements of type
-- 'customer_return' — that column is varchar(17) with no CHECK, so it needs
-- no change.)
--   * order_returns      — one row per return: the order, a unique
--                          request_id (a retried submission finds the row
--                          instead of recording twice), reason, note, the
--                          date the goods came back, the staff username, the
--                          value of the returned units and the revenue the
--                          ledger reversed (0 for an order never recognized).
--   * order_return_items — the lines of a return: which order line, how many
--                          units, whether they went back to stock, their value.
--
-- Security: RLS on, no policies, no Data API privileges — like the other
-- recent tables (promotions, order_status_changes); both backends connect as
-- the table owner.
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_returns (
    id                 varchar PRIMARY KEY,
    order_id           varchar NOT NULL REFERENCES public.orders (id),
    request_id         varchar(64) NOT NULL UNIQUE,
    reason             varchar(200) NOT NULL CHECK (length(btrim(reason)) > 0),
    note               text,
    returned_on        date NOT NULL,
    processed_by       varchar NOT NULL,
    merchandise_value  double precision NOT NULL DEFAULT 0 CHECK (merchandise_value >= 0),
    revenue_reversed   double precision NOT NULL DEFAULT 0 CHECK (revenue_reversed >= 0),
    created_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_returns_order_id ON public.order_returns (order_id);

CREATE TABLE IF NOT EXISTS public.order_return_items (
    id             varchar PRIMARY KEY,
    return_id      varchar NOT NULL REFERENCES public.order_returns (id) ON DELETE CASCADE,
    order_item_id  varchar NOT NULL REFERENCES public.order_items (id),
    product_id     varchar NOT NULL REFERENCES public.products (id),
    quantity       integer NOT NULL CHECK (quantity > 0),
    restock        boolean NOT NULL,
    amount         double precision NOT NULL DEFAULT 0 CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS ix_order_return_items_return_id ON public.order_return_items (return_id);
CREATE INDEX IF NOT EXISTS ix_order_return_items_order_item_id ON public.order_return_items (order_item_id);

ALTER TABLE public.order_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_returns, public.order_return_items FROM anon, authenticated;

COMMIT;
