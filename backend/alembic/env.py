"""Migration environment for the shared EcoBel database.

This is the only migration history for that database — both services'
tables live in it, and ecobel-website mirrors the shared tables' models
without migrating anything itself.
"""
from alembic import context

from app import models
from app.database import engine

target_metadata = models.Base.metadata

# Tables in the database that no current model describes. They are left
# exactly as they are — never created, altered or dropped by migrations.
#   staff_users: superseded by `users` (6 legacy rows, unused by both services).
UNMANAGED_TABLES = {"staff_users"}


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table" and name in UNMANAGED_TABLES:
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=str(engine.url),
        target_metadata=target_metadata,
        literal_binds=True,
        include_object=include_object,
        compare_type=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # A caller (app startup) may hand us its own connection.
    connection = context.config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    with engine.connect() as conn:
        _run(conn)


def _run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
        compare_type=True,
        # SQLite (local/tests) can't ALTER constraints in place; batch mode
        # rebuilds the table there and is a plain ALTER on PostgreSQL.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
