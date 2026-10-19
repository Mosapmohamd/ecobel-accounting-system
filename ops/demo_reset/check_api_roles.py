"""What can the Data API roles (anon, authenticated) do on the six tables? Every probe
runs inside a transaction that is rolled back, so it never changes data.

    python check_api_roles.py --dsn "host=127.0.0.1 port=55432 user=postgres dbname=rehearsal"   # isolated copy
    python check_api_roles.py                                                                    # Supabase (via backend/.env)
"""
import argparse

import psycopg2

import common

TABLES = ["reviews", "shipping_rates", "featured_products", "featured_routines", "auth_throttle", "alembic_version"]
PROBES = {
    "read": 'SELECT count(*) FROM public."{t}"',
    "update": 'UPDATE public."{t}" SET {c} = {c} WHERE true',
    "delete": 'DELETE FROM public."{t}" WHERE true',
}
FIRST_COL = {"reviews": "rating", "shipping_rates": "fee", "featured_products": "position", "featured_routines": "position",
             "auth_throttle": "failures", "alembic_version": "version_num"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn")
    ap.add_argument("--env", default=common.DEFAULT_ENV)
    a = ap.parse_args()
    if a.dsn:
        assert "127.0.0.1" in a.dsn or "localhost" in a.dsn
        conn = psycopg2.connect(a.dsn)
    else:
        url = common.database_url(a.env)
        common.assert_target(url)
        conn = common.connect(url)
    cur = conn.cursor()
    exposed = 0
    for role in ("anon", "authenticated"):
        for t in TABLES:
            results = []
            for name, sql in PROBES.items():
                cur.execute("BEGIN")
                cur.execute(f"SET LOCAL ROLE {role}")
                try:
                    cur.execute(sql.format(t=t, c=FIRST_COL[t]))
                    rows = cur.fetchone()[0] if name == "read" else cur.rowcount
                    # RLS without policies: the statement runs but sees/affects 0 rows
                    allowed = rows > 0
                    results.append(f"{name}={'ALLOWED(' + str(rows) + ')' if allowed else 'no rows visible'}")
                    exposed += allowed
                except psycopg2.Error as e:
                    results.append(f"{name}=denied({e.pgcode})")
                finally:
                    conn.rollback()
            print(f"{role:13} {t:18} " + "  ".join(results))
    # Inserts prove protection even on empty tables (where read/update/delete see 0 rows anyway).
    inserts = {
        "auth_throttle": "INSERT INTO public.auth_throttle (key, failures, window_started_at) VALUES ('probe', 0, now())",
        "alembic_version": "INSERT INTO public.alembic_version (version_num) VALUES ('probe')",
        "shipping_rates": "INSERT INTO public.shipping_rates (id, city, fee, is_active) VALUES ('probe', 'probe', 0, true)",
    }
    for role in ("anon", "authenticated"):
        for t, sql in inserts.items():
            cur.execute("BEGIN")
            cur.execute(f"SET LOCAL ROLE {role}")
            try:
                cur.execute(sql)
                print(f"{role:13} {t:18} insert=ALLOWED")
                exposed += 1
            except psycopg2.Error as e:
                print(f"{role:13} {t:18} insert=denied({e.pgcode})")
            finally:
                conn.rollback()
    cur.execute("""SELECT count(*) FILTER (WHERE c.relrowsecurity), count(*) FROM pg_class c
                   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'""")
    print("public tables with RLS enabled: %s of %s" % cur.fetchone())
    print("EXPOSED operations:", exposed)


if __name__ == "__main__":
    main()
