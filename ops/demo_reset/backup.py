"""Full, consistent backup of the EcoBel Supabase database — read-only.

    python backup.py --pgbin <dir with pg_dump 17> --out <backup root>

One REPEATABLE READ READ ONLY transaction exports a snapshot; pg_dump runs on
that same snapshot, and the per-table checksums in manifest.json are taken
inside it too, so the dumps and the manifest describe exactly the same data.

Produces <out>/<UTC timestamp>/:
  full.dump     pg_dump -Fc of the whole database (every schema readable by the role)
  public.dump   pg_dump -Fc of schema public (the restore unit for EcoBel data)
  meta.dump     data of storage.buckets, storage.objects, auth.users
  roles.txt     role names/flags referenced by grants (no passwords exist to read)
  manifest.json identity, revision, row counts + md5 per table, sha256 per file
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from urllib.parse import urlparse

import common


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pgbin", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--env", default=common.DEFAULT_ENV)
    ap.add_argument("--local-url", help="test the procedure on an isolated local database (127.0.0.1 only)")
    a = ap.parse_args()

    if a.local_url:
        if urlparse(a.local_url).hostname not in ("127.0.0.1", "localhost"):
            raise SystemExit("--local-url is only for an isolated local database")
        url = a.local_url
    else:
        url = common.database_url(a.env)
        common.assert_target(url)
    env = common.libpq_env(url)
    if a.local_url:
        env["PGSSLMODE"] = "disable"
    pg_dump = os.path.join(a.pgbin, "pg_dump")

    conn = common.connect(url)
    conn.set_session(isolation_level="REPEATABLE READ", readonly=True)
    cur = conn.cursor()
    cur.execute("SELECT pg_export_snapshot(), now(), current_database(), current_setting('server_version'), "
                "(SELECT version_num FROM public.alembic_version), inet_server_addr()::text")
    snapshot, taken_at, dbname, version, revision, server_addr = cur.fetchone()
    stamp = taken_at.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = os.path.join(a.out, stamp)
    os.makedirs(out)
    common.restrict_to_current_user(out)

    tables = common.public_tables(cur)
    meta = [] if a.local_url else common.SUPABASE_META_TABLES
    checksums = common.table_checksums(cur, tables + meta)
    structure = common.structure(cur)
    cur.execute("""SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls FROM pg_roles r
                   WHERE r.rolname IN (SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema='public')
                      OR r.rolname = current_user ORDER BY 1""")
    with open(os.path.join(out, "roles.txt"), "w", encoding="utf-8") as f:
        f.writelines(f"{n}\tlogin={l}\tsuper={s}\tbypassrls={b}\n" for n, l, s, b in cur.fetchall())

    dumps = {
        "full.dump": ["-Fc"],
        "public.dump": ["-Fc", "-n", "public"],
    }
    if not a.local_url:
        dumps["meta.dump"] = ["-Fc", "--data-only", "-t", "storage.buckets", "-t", "storage.objects", "-t", "auth.users"]
    results = {}
    for name, opts in dumps.items():
        p = common.run([pg_dump, f"--snapshot={snapshot}", "--no-password", *opts, "-f", os.path.join(out, name)], env)
        results[name] = {"exit": p.returncode, "stderr": p.stderr.strip()[-2000:]}
    conn.rollback()
    conn.close()

    files = {}
    for name in sorted(os.listdir(out)):
        data = open(os.path.join(out, name), "rb").read()
        files[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    manifest = {
        "project_ref": "LOCAL TEST" if a.local_url else common.PROJECT_REF, "database": dbname, "server_version": version,
        "taken_at": taken_at.isoformat(), "snapshot_isolation": "REPEATABLE READ READ ONLY + pg_export_snapshot",
        "alembic_revision": revision, "structure": structure, "pg_dump": results, "tables": checksums, "files": files,
    }
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    ok = all(r["exit"] == 0 for r in results.values())
    print(f"backup {'OK' if ok else 'INCOMPLETE'}: {out}")
    for name, r in results.items():
        print(f"  {name}: exit {r['exit']}, {files.get(name, {}).get('bytes', 0):,} bytes" + (f" | {r['stderr'][:300]}" if r["exit"] else ""))
    print(f"  revision {revision} | {len(tables)} public tables | {sum(v['rows'] for k, v in checksums.items() if k.startswith('public.')):,} rows")
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
