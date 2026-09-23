"""
Tiny schema-sync helper used instead of Alembic (see the README for why).

`create_all` only creates tables that don't exist yet — it never alters an
existing table, so adding a new column to a model (like Product.image_url)
needs a manual `ALTER TABLE ... ADD COLUMN` the first time the app runs
against a database created before that column existed. This module does
just that, defensively (skips any column that's already there), for both
SQLite and PostgreSQL.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# (table, column, column_type_sql, default_sql_or_None) — add an entry here
# whenever a column is added to an existing shared/website table's model.
# The default (a raw SQL literal, e.g. "0" or "'spending'") backfills
# existing rows so they don't end up with NULL where the model expects a
# real value; omit it (None) for columns that are fine staying NULL.
_COLUMNS_TO_ENSURE = [
    ("products", "image_url", "VARCHAR", None),
    ("products", "description", "TEXT", None),
    ("finance_entries", "source", "VARCHAR", "'spending'"),
    ("orders", "city", "VARCHAR", None),
    ("b2b_orders", "extra_discount_percentage", "FLOAT", "0"),
]


def ensure_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, column, column_type, default in _COLUMNS_TO_ENSURE:
            if table not in existing_tables:
                continue  # create_all will make the table (with the column) fresh
            existing_columns = {c["name"] for c in inspector.get_columns(table)}
            if column in existing_columns:
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}"))
            if default is not None:
                conn.execute(text(f"UPDATE {table} SET {column} = {default} WHERE {column} IS NULL"))
