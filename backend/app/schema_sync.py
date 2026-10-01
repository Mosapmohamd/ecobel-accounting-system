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

# (table, column, old_value, new_value) — for values that used to be valid
# (an old status/enum name from an earlier version of the app, or data
# imported from another system) but aren't recognized by the current code
# anymore. Add an entry here instead of manually patching the database
# whenever a value like this turns up.
_LEGACY_VALUES_TO_FIX = [
    ("orders", "status", "completed", "delivered"),
    ("orders", "status", "refunded", "cancelled"),
    ("orders", "status", "processing", "pending"),
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

        for table, column, old_value, new_value in _LEGACY_VALUES_TO_FIX:
            if table not in existing_tables:
                continue
            # CAST(... AS TEXT) matters on PostgreSQL: the column is a
            # native ENUM there, and comparing it directly to a label
            # that isn't part of the enum ("completed") raises "invalid
            # input value for enum" instead of just matching no rows.
            conn.execute(
                text(f"UPDATE {table} SET {column} = :new_value WHERE CAST({column} AS TEXT) = :old_value"),
                {"new_value": new_value, "old_value": old_value},
            )
