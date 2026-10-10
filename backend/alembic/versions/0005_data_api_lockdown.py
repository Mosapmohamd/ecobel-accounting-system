"""Close Supabase's Data API on the six public tables that had RLS off.

Supabase exposes schema `public` through its Data API (PostgREST) to the
`anon` and `authenticated` roles, and grants those roles full privileges on
every table by default. 18 tables already had row-level security on with no
policies (so the API sees nothing); these six did not, so anyone holding the
public API key could read and write them — e.g. zero the shipping fees,
insert approved reviews, clear login-throttle blocks, change the recorded
schema revision (Supabase advisor "rls_disabled_in_public", level ERROR).

Neither service needs the Data API: both backends connect as the table
owner (`postgres`, BYPASSRLS), and the storefront/admin frontends only call
the two backends. So every table in `public` gets RLS on with no policies.
On the live database that changes only these six (the other 18 had been
switched on in the Supabase dashboard, outside migrations); on a database
built from migrations it covers every table, so a new environment is never
left open. The migration metadata and login-throttle state also lose every
API-role privilege.

Downgrade turns RLS off again only for the six tables this release closed —
the state the live database had before.

PostgreSQL only (SQLite has neither RLS nor roles); the role statements are
skipped where the Supabase roles don't exist (e.g. a plain local PostgreSQL).
No data changes.

Revision ID: 0005_data_api_lockdown
Revises: 0004_abuse_controls
Create Date: 2026-10-10
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0005_data_api_lockdown"
down_revision: Union[str, Sequence[str], None] = "0004_abuse_controls"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("reviews", "shipping_rates", "featured_products", "featured_routines", "auth_throttle", "alembic_version")
NO_API_PRIVILEGES = ("alembic_version", "auth_throttle")
API_ROLES = ("anon", "authenticated")


def _for_existing_api_roles(statement: str) -> None:
    """Runs `statement` (with {role}) for each Supabase API role that exists here."""
    for role in API_ROLES:
        op.execute(
            f"DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN "
            f"EXECUTE '{statement.format(role=role)}'; END IF; END $$"
        )


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    # Every table in public (a no-op where RLS is already on).
    op.execute("""
        DO $$ DECLARE t text; BEGIN
            FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
                EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
            END LOOP;
        END $$
    """)
    _for_existing_api_roles("REVOKE ALL ON public.alembic_version, public.auth_throttle FROM {role}")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    _for_existing_api_roles("GRANT ALL ON public.alembic_version, public.auth_throttle TO {role}")
    for table in TABLES:
        op.execute(f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY")
