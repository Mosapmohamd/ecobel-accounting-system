"""Prove a backup is restorable: restore public.dump into a NEW database on an
ISOLATED local PostgreSQL 17 and compare it with the manifest.

    python verify_restore.py --pgbin <dir> --backup <backup dir> --admin-dsn "host=127.0.0.1 port=55432 user=pgsuper dbname=postgres"

The local cluster needs the roles the dump references (postgres as a
non-superuser owner with BYPASSRLS, anon, authenticated, service_role) so
ownership, grants and RLS restore exactly as in Supabase.

Checks: file sha256 = manifest; every archive's table of contents is
readable; pg_restore of public.dump exits 0 with no errors; every public
table's row count AND content md5 equal the manifest; constraints, indexes,
RLS flags, column count and API-role grants equal the manifest.
full.dump / meta.dump contain Supabase-only schemas (auth, storage, vault…)
that a plain PostgreSQL cannot host, so they are integrity-checked
(sha256 + readable TOC), not restored.
"""
import argparse
import hashlib
import json
import os

import psycopg2

import common


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pgbin", required=True)
    ap.add_argument("--backup", required=True)
    ap.add_argument("--admin-dsn", required=True)
    a = ap.parse_args()
    if "127.0.0.1" not in a.admin_dsn and "localhost" not in a.admin_dsn:
        raise SystemExit("restore verification only runs against an isolated local cluster")
    man = json.load(open(os.path.join(a.backup, "manifest.json"), encoding="utf-8"))
    ok = True

    def report(label, good, detail=""):
        nonlocal ok
        ok &= bool(good)
        print(("PASS " if good else "FAIL ") + label + (f" — {detail}" if detail else ""))

    for name, f in man["files"].items():
        if name == "manifest.json":
            continue
        data = open(os.path.join(a.backup, name), "rb").read()
        report(f"sha256 {name}", hashlib.sha256(data).hexdigest() == f["sha256"], f"{len(data):,} bytes")
    for name in [n for n in man["files"] if n.endswith(".dump")]:
        p = common.run([os.path.join(a.pgbin, "pg_restore"), "--list", os.path.join(a.backup, name)], os.environ.copy())
        report(f"TOC readable {name}", p.returncode == 0, f"{sum(1 for l in p.stdout.splitlines() if l and not l.startswith(';'))} entries")

    target = "verify_" + os.path.basename(os.path.normpath(a.backup)).lower()
    admin = psycopg2.connect(a.admin_dsn)
    admin.autocommit = True
    acur = admin.cursor()
    acur.execute(f'DROP DATABASE IF EXISTS "{target}"')
    acur.execute(f'CREATE DATABASE "{target}" OWNER postgres')
    admin.close()
    kv = dict(x.split("=", 1) for x in a.admin_dsn.split())
    env = dict(os.environ, PGHOST=kv.get("host", "127.0.0.1"), PGPORT=kv.get("port", "5432"), PGUSER=kv.get("user", "postgres"),
               PGDATABASE=target, PGSSLMODE="disable")
    pre = psycopg2.connect(host=env["PGHOST"], port=env["PGPORT"], user=env["PGUSER"], dbname=target)
    pre.autocommit = True
    pre.cursor().execute("DROP SCHEMA public CASCADE")  # the dump recreates it with its original owner/grants
    pre.close()
    p = common.run([os.path.join(a.pgbin, "pg_restore"), "--exit-on-error", "--single-transaction", "-d", target,
                    os.path.join(a.backup, "public.dump")], env)
    report("pg_restore public.dump into isolated database " + target, p.returncode == 0, p.stderr.strip()[:500])

    conn = psycopg2.connect(host=env["PGHOST"], port=env["PGPORT"], user="postgres", dbname=target)
    cur = conn.cursor()
    tables = common.public_tables(cur)
    got = common.table_checksums(cur, tables)
    want = {k: v for k, v in man["tables"].items() if k.startswith("public.")}
    diff = [k for k in want if got.get(k) != want[k]] + [k for k in got if k not in want]
    report(f"{len(want)} tables: row counts + content md5 identical", not diff, f"{sum(v['rows'] for v in got.values()):,} rows" + (f" | differ: {diff}" if diff else ""))
    s_got, s_want = common.structure(cur), man.get("structure", {})
    for key in s_want:
        report(f"structure: {key}", s_got[key] == s_want[key] or json.loads(json.dumps(s_got[key])) == s_want[key])
    cur.execute("SELECT version_num FROM alembic_version")
    report("alembic revision", cur.fetchone()[0] == man["alembic_revision"], man["alembic_revision"])
    conn.close()
    print("RESTORE VERIFIED" if ok else "RESTORE NOT VERIFIED")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
