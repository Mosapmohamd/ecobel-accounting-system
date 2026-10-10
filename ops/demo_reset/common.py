"""Shared helpers for the demo-reset tooling. Connection details come from
backend/.env (DATABASE_URL) and are never printed."""
import os
import subprocess
from urllib.parse import unquote, urlparse

import psycopg2
from dotenv import dotenv_values

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ENV = os.path.join(HERE, "..", "..", "backend", ".env")
PROJECT_REF = "oelhvhwagfrmodhqpxxf"

# Every per-table checksum is computed with these settings on both sides
# (source and restored copy), so text output is identical.
CHECKSUM_SESSION = "SET TimeZone = 'UTC'; SET DateStyle = 'ISO, MDY'; SET extra_float_digits = 1;"


def database_url(env_path: str = DEFAULT_ENV) -> str:
    url = dotenv_values(env_path).get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL missing from " + env_path)
    return url


def assert_target(url: str, ref: str = PROJECT_REF) -> None:
    """Refuses to touch any database but the EcoBel project's pooler."""
    u = urlparse(url)
    if ref not in (u.username or "") or not (u.hostname or "").endswith(".pooler.supabase.com"):
        raise SystemExit(f"Refusing: DATABASE_URL is not the Supabase project {ref}")


def libpq_env(url: str) -> dict:
    """pg_dump/psql settings as environment variables (keeps the password off the command line)."""
    u = urlparse(url)
    env = dict(os.environ)
    env.update(PGHOST=u.hostname, PGPORT=str(u.port or 5432), PGUSER=unquote(u.username or ""),
               PGPASSWORD=unquote(u.password or ""), PGDATABASE=(u.path or "/postgres").lstrip("/"),
               PGSSLMODE="require", PGAPPNAME="ecobel-demo-reset")
    return env


def connect(url: str):
    return psycopg2.connect(url, application_name="ecobel-demo-reset")


def table_checksums(cur, tables: list[tuple[str, str]]) -> dict:
    """{schema.table: {rows, md5}} — md5 over every row's text form, ordered byte-wise."""
    cur.execute(CHECKSUM_SESSION)
    out = {}
    for schema, table in tables:
        cur.execute(f'SELECT count(*), md5(coalesce(string_agg(t::text, E\'\\n\' ORDER BY t::text COLLATE "C"), \'\')) '
                    f'FROM "{schema}"."{table}" t')
        n, digest = cur.fetchone()
        out[f"{schema}.{table}"] = {"rows": n, "md5": digest}
    return out


def public_tables(cur) -> list[tuple[str, str]]:
    cur.execute("SELECT 'public', tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 2")
    return [tuple(r) for r in cur.fetchall()]


SUPABASE_META_TABLES = [("storage", "buckets"), ("storage", "objects"), ("auth", "users")]


def run(cmd: list[str], env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")


def restrict_to_current_user(path: str) -> None:
    """Windows: remove inherited ACLs, grant only the current user (and SYSTEM)."""
    if os.name == "nt":
        user = os.environ.get("USERNAME")
        subprocess.run(["icacls", path, "/inheritance:r", "/grant:r", f"{user}:(OI)(CI)F", "SYSTEM:(OI)(CI)F", "/T", "/Q"],
                       capture_output=True, check=True)


def structure(cur) -> dict:
    """Schema facts compared between the source and a restored copy."""
    q = lambda sql: cur.execute(sql) or cur.fetchall()
    return {
        "constraints": dict(q("""SELECT contype::text, count(*) FROM pg_constraint
                                 WHERE connamespace = 'public'::regnamespace GROUP BY 1 ORDER BY 1""")),
        "indexes": sorted(r[0] for r in q("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")),
        "rls_tables": sorted(r[0] for r in q("""SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace
                                               AND relkind = 'r' AND relrowsecurity""")),
        "columns": q("""SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'""")[0][0],
        "api_role_grants": sorted(f"{t}:{g}:{p}" for t, g, p in q("""SELECT table_name, grantee, privilege_type
                                  FROM information_schema.role_table_grants WHERE table_schema = 'public'
                                  AND grantee IN ('anon', 'authenticated', 'service_role')""")),
    }
