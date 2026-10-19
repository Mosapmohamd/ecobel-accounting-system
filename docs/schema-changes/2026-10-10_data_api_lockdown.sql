-- 2026-10-10 — Close Supabase's Data API on the public schema.
-- Applied to the shared Supabase project on 2026-10-10 (then as Alembic
-- revision 0005_data_api_lockdown). Kept as the reviewed record.
--
-- Six public tables (reviews, shipping_rates, featured_products,
-- featured_routines, auth_throttle, alembic_version) had RLS off while
-- Supabase grants anon/authenticated full privileges, so anyone with the
-- public API key could read and write them. Neither backend uses the Data
-- API (both connect as the table owner, which has BYPASSRLS) and no frontend
-- calls it, so every public table gets RLS on with no policies.
BEGIN;
DO $$ DECLARE t text; BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;
REVOKE ALL ON public.alembic_version, public.auth_throttle FROM anon, authenticated;
COMMIT;

-- Rollback (restores the earlier, exposed state — don't, unless something breaks):
-- BEGIN;
-- GRANT ALL ON public.alembic_version, public.auth_throttle TO anon, authenticated;
-- ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;   -- and shipping_rates,
--   featured_products, featured_routines, auth_throttle, alembic_version
-- COMMIT;
