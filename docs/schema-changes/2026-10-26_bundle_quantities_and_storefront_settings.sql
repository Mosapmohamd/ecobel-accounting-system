-- 2026-10-26 — Fixed-bundle quantities + storefront runtime settings.
-- STATUS: applied to the shared Supabase project on 2026-10-26 (after review,
-- a verified backup and a dry run; one transaction, every table checked
-- unchanged). Deploy the code that uses it after it.
-- Requires 2026-10-24_promotions.sql (applied 2026-10-24).
--
-- Additive and backward compatible:
--   * promotion_targets.quantity — how many units of a product a FIXED bundle
--     (config.mode = 'combination') contains. Default 1, so every existing
--     target keeps exactly its current meaning (one unit of each product).
--     Ignored for every other role/type.
--   * storefront_settings — runtime settings the storefront reads without a
--     rebuild, one JSON value per key (first key: 'announcement_bar'). Values
--     are validated by the accounting API (structured fields only — no HTML,
--     no CSS); the storefront renders them as plain text.
-- No existing row is modified.
--
-- Security: RLS on, no policies, no Data API privileges — like every public
-- table (both backends connect as the table owner).
BEGIN;

ALTER TABLE public.promotion_targets
    ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_promotion_targets_quantity') THEN
        ALTER TABLE public.promotion_targets
            ADD CONSTRAINT ck_promotion_targets_quantity CHECK (quantity BETWEEN 1 AND 50);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.storefront_settings (
    key         varchar PRIMARY KEY,
    value       jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by  varchar,
    updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.storefront_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storefront_settings FROM anon, authenticated;

COMMIT;

-- Verify (read-only):
--   SELECT count(*) FROM promotion_targets WHERE quantity <> 1;                  -- 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'storefront_settings';  -- true
--
-- Rollback (deploy the previous code first; discards saved storefront
-- settings and fixed-bundle quantities):
-- BEGIN;
-- DROP TABLE IF EXISTS public.storefront_settings;
-- ALTER TABLE public.promotion_targets DROP CONSTRAINT IF EXISTS ck_promotion_targets_quantity;
-- ALTER TABLE public.promotion_targets DROP COLUMN IF EXISTS quantity;
-- COMMIT;
