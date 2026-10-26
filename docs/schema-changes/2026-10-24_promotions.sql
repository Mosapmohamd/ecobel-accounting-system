-- 2026-10-24 — Promotions (the admin Offer Builder): cart-level offers.
-- STATUS: applied to the shared Supabase project on 2026-10-24 (after review
-- and owner approval; RLS verified). Deploy the code that uses it after it.
--
-- Additive and backward compatible:
--   * promotions        — one row per offer: type (bundle, free_shipping,
--                         percentage, fixed_amount, buy_x_get_y), status
--                         (draft / active / inactive — "scheduled" and
--                         "expired" are derived from the dates), schedule,
--                         priority, combination flag, minimum subtotal,
--                         usage limits + counter, type-specific settings.
--   * promotion_targets — the products / categories an offer applies to
--                         ('eligible') or rewards ('reward', Buy X Get Y).
--   * order_promotions  — what each order received: a snapshot of the offer's
--                         terms at purchase time, the discount, the shipping
--                         discount and the units involved. promotion_id is
--                         deliberately NOT a foreign key, so history stays
--                         readable if an offer is ever deleted (the app only
--                         deletes offers that were never used).
--   * orders.promotion_discount — the product discount from promotions
--                         (coupon discount stays in orders.discount_amount;
--                         the shipping discount is in order_promotions).
-- The existing per-product sale prices (table `offers`) and coupons are
-- unchanged. No existing row is modified except that every existing order
-- gets promotion_discount = 0.
--
-- Security: RLS on, no policies, no Data API privileges — like every public
-- table (both backends connect as the table owner).
BEGIN;

CREATE TABLE IF NOT EXISTS public.promotions (
    id                  varchar PRIMARY KEY,
    name                varchar NOT NULL,
    description         text,
    badge_text          varchar,
    type                varchar NOT NULL CHECK (type IN ('bundle', 'free_shipping', 'percentage', 'fixed_amount', 'buy_x_get_y')),
    status              varchar NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'inactive')),
    starts_at           timestamptz,
    ends_at             timestamptz,
    priority            integer NOT NULL DEFAULT 0,
    combinable          boolean NOT NULL DEFAULT false,
    min_subtotal        double precision CHECK (min_subtotal IS NULL OR min_subtotal >= 0),
    usage_limit         integer CHECK (usage_limit IS NULL OR usage_limit > 0),
    per_customer_limit  integer CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
    used_count          integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    config              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by          varchar,
    updated_by          varchar,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),
    CONSTRAINT ck_promotions_dates CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);
CREATE INDEX IF NOT EXISTS ix_promotions_status ON public.promotions (status);

CREATE TABLE IF NOT EXISTS public.promotion_targets (
    id            varchar PRIMARY KEY,
    promotion_id  varchar NOT NULL REFERENCES public.promotions (id) ON DELETE CASCADE,
    role          varchar NOT NULL CHECK (role IN ('eligible', 'reward')),
    product_id    varchar REFERENCES public.products (id),
    category_id   varchar REFERENCES public.categories (id),
    CONSTRAINT ck_promotion_targets_one_target CHECK ((product_id IS NULL) <> (category_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_promotion_targets_promotion ON public.promotion_targets (promotion_id);

CREATE TABLE IF NOT EXISTS public.order_promotions (
    id                 varchar PRIMARY KEY,
    order_id           varchar NOT NULL REFERENCES public.orders (id),
    promotion_id       varchar NOT NULL,
    customer_id        varchar REFERENCES public.customers (id),
    name               varchar NOT NULL,
    type               varchar NOT NULL,
    terms              jsonb NOT NULL DEFAULT '{}'::jsonb,
    discount           double precision NOT NULL DEFAULT 0 CHECK (discount >= 0),
    shipping_discount  double precision NOT NULL DEFAULT 0 CHECK (shipping_discount >= 0),
    details            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_order_promotions_order ON public.order_promotions (order_id);
CREATE INDEX IF NOT EXISTS ix_order_promotions_promotion_customer ON public.order_promotions (promotion_id, customer_id);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promotion_discount double precision NOT NULL DEFAULT 0;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_promotions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotions, public.promotion_targets, public.order_promotions FROM anon, authenticated;

COMMIT;

-- Verify (read-only):
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('promotions', 'promotion_targets', 'order_promotions');      -- all true
--   SELECT count(*) FROM orders WHERE promotion_discount <> 0;                       -- 0
--
-- Rollback (only before any order used a promotion — it discards the offers
-- and their per-order history). Deploy the previous code first:
-- BEGIN;
-- DROP TABLE IF EXISTS public.order_promotions;
-- DROP TABLE IF EXISTS public.promotion_targets;
-- DROP TABLE IF EXISTS public.promotions;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS promotion_discount;
-- COMMIT;
