"""Brings the shared database to the latest migration (alembic/versions).

This service owns the one migration history for the database it shares
with ecobel-website; the website never migrates, it only checks the
revision. Runs on startup and from the seed/admin scripts.
"""
import os

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

_ALEMBIC_INI = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alembic.ini")


def upgrade_to_head(engine: Engine) -> None:
    with engine.begin() as conn:
        tables = set(inspect(conn).get_table_names())
        if "alembic_version" not in tables and "products" in tables:
            # Tables exist but were never migrated — never guess at that.
            raise RuntimeError(
                "This database predates migrations. Confirm its schema matches "
                "alembic/versions/0001_baseline.py, then run "
                "`alembic stamp 0001_baseline` once and restart."
            )
        cfg = Config(_ALEMBIC_INI)
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
