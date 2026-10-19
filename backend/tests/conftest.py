"""Test database: every test module shares one throwaway SQLite file whose
tables are built here from the models.

This is test-only. The application itself never creates or alters tables —
the real schema is managed in Supabase (docs/DATABASE_SCHEMA_MANAGEMENT.md).
"""
import os
import sys
import tempfile

if "app.database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
    os.environ.pop("SECRET_KEY", None)

from app import models  # noqa: E402
from app.database import engine  # noqa: E402

assert engine.url.get_backend_name() == "sqlite", "tests build their schema only in a throwaway SQLite database"
models.Base.metadata.create_all(bind=engine)
