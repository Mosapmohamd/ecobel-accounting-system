-- EcoBel: close the Supabase Data API on the six public tables that had RLS off.
-- Applied durably as Alembic migration 0005_data_api_lockdown (backend/alembic/versions);
-- this file is the reviewed SQL kept for reference.
-- (Supabase advisor "rls_disabled_in_public", level ERROR).
--
-- Why this is safe for the apps: both backends connect as `postgres`, which owns
-- every public table and has BYPASSRLS, so RLS never filters their queries. No
-- frontend talks to Supabase's Data API (the storefront and admin only call
-- the two FastAPI backends; product photos are public Storage URLs, which this
-- does not touch). So the storefront needs NO direct public reads, and these six
-- tables get the same treatment as the other 18: RLS on, no policies, i.e. the
-- anon/authenticated API roles can neither read nor write them.
--
-- Migration metadata and login-throttle state additionally lose every API-role
-- privilege (defence in depth even if a policy were added by mistake later).
BEGIN;
ALTER TABLE public.reviews           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_rates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_throttle     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alembic_version   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alembic_version, public.auth_throttle FROM anon, authenticated;
COMMIT;

-- Rollback (restores the previous, exposed state — only if something breaks):
-- BEGIN;
-- ALTER TABLE public.reviews DISABLE ROW LEVEL SECURITY;  -- …same for the other five
-- GRANT ALL ON public.alembic_version, public.auth_throttle TO anon, authenticated;
-- COMMIT;
