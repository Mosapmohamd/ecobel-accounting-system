-- 2026-10-19 — Short product descriptions and additional product photos.
-- STATUS: applied to the shared Supabase project on 2026-10-19 (after review
-- and owner approval), in one transaction with before/after checks: every
-- existing row unchanged, RLS on 25/25 public tables, no Data API access.
-- Any other database (e.g. production) needs it before the code that uses it.
--
-- Additive and backward compatible:
--   * products.short_description — new, nullable. Existing rows get NULL and
--     render exactly as before; `products.description` stays the full text.
--   * product_images — new table of additional photos per product (the main
--     photo stays `products.image_key`, so every existing reader — cards,
--     cart, routines, featured slots — is unchanged). It stores Storage keys
--     only ("products/<product_id>/<random>.<ext>"), never image bytes.
--   * No existing row, column, constraint or policy is changed or removed.
--
-- ON DELETE CASCADE on product_images only removes a product's own photo
-- rows if a product were ever hard-deleted; the apps never hard-delete
-- products (they archive with is_active = false), and no other table
-- references product_images.
--
-- Security: like every public table, RLS on with no policies, and no Data
-- API privileges — both backends connect as the table owner (BYPASSRLS),
-- no browser talks to the Data API.
BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS short_description text;

CREATE TABLE IF NOT EXISTS public.product_images (
    id          varchar PRIMARY KEY,
    product_id  varchar NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
    image_key   varchar NOT NULL UNIQUE,
    position    integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_product_images_product_position
    ON public.product_images (product_id, position);

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_images FROM anon, authenticated;

COMMIT;

-- Verify (read-only):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'short_description';
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_images'::regclass;   -- true
--   SELECT count(*) FROM public.product_images;                                          -- 0
--
-- Rollback (only before any photo/short description was saved through the
-- new code — it discards them; uploaded files would then be orphans, listed
-- by `python -m app.product_images orphans`). Deploy the previous code first:
-- BEGIN;
-- DROP TABLE IF EXISTS public.product_images;
-- ALTER TABLE public.products DROP COLUMN IF EXISTS short_description;
-- COMMIT;
