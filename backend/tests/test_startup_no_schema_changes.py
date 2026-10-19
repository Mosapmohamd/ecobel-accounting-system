"""Starting the app never touches the schema: no migrations (Alembic isn't
even importable here), no create_all, no DDL — whatever revision a legacy
alembic_version table records. The schema is managed in Supabase.

Each case starts the real app (lifespan included) in a fresh interpreter
against its own throwaway SQLite file, then inspects that file."""
import os
import sqlite3
import subprocess
import sys
import tempfile

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STARTUP = r"""
import sys
class _NoAlembic:
    def find_spec(self, name, path=None, target=None):
        if name == "alembic" or name.startswith("alembic."):
            raise ImportError("alembic is not available")
sys.meta_path.insert(0, _NoAlembic())
from fastapi.testclient import TestClient
from app.main import app
with TestClient(app) as client:
    assert client.get("/").status_code == 200
assert not any(m == "alembic" or m.startswith("alembic.") for m in sys.modules)
print("STARTED")
"""


def start_app_against(db_path: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in ("SECRET_KEY", "ENVIRONMENT")}
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    return subprocess.run([sys.executable, "-c", STARTUP], cwd=BACKEND, env=env,
                          capture_output=True, text=True, timeout=120)


def tables(db_path: str) -> list[str]:
    with sqlite3.connect(db_path) as conn:
        return sorted(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'"))


def test_startup_on_an_empty_database_creates_nothing():
    db = os.path.join(tempfile.mkdtemp(), "empty.db")
    sqlite3.connect(db).close()
    run = start_app_against(db)
    assert "STARTED" in run.stdout, run.stderr[-2000:]
    assert tables(db) == []  # no create_all, no migration, no DDL
    assert "schema lacks" in run.stderr  # the read-only check warns instead of fixing anything


def test_startup_ignores_a_legacy_alembic_revision():
    """The live database still records 0005_data_api_lockdown in alembic_version;
    the app neither reads nor changes it, and starts normally."""
    db = os.path.join(tempfile.mkdtemp(), "legacy.db")
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)")
        conn.execute("INSERT INTO alembic_version VALUES ('0005_data_api_lockdown')")
    run = start_app_against(db)
    assert "STARTED" in run.stdout, run.stderr[-2000:]
    assert tables(db) == ["alembic_version"]
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchall() == [("0005_data_api_lockdown",)]
