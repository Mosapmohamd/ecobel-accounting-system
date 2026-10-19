import logging
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker, declarative_base

# Load backend/.env into the real process environment. Without this,
# os.getenv() below only sees actual OS environment variables — a .env
# file sitting next to this code does nothing on its own, and every
# setting quietly falls back to its default (e.g. the local SQLite file)
# with no error, which is exactly the trap this line prevents.
load_dotenv()

# The accounting system and the website both point DATABASE_URL at the SAME
# database (a shared PostgreSQL/Supabase instance in production). This
# service owns the core tables (products, categories, inventory, finance,
# B2B) and also sees the website's tables (customers, coupons, orders) so
# the admin can manage online orders and coupons from here.
#
# Default falls back to a local SQLite file for development/testing only.
# In production, set DATABASE_URL to the same PostgreSQL connection string
# used by ecobel-accounting-system (e.g. a Supabase connection string).
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./ecobel_dev.db")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # PostgreSQL (incl. Supabase). pool_pre_ping recycles connections that
    # the server dropped (Supabase closes idle ones), and the small bounded
    # pool keeps us well under Supabase's connection cap — especially on the
    # free tier. If you use Supabase's Session Pooler URL (port 6543) these
    # limits still apply harmlessly.
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        pool_recycle=1800,  # recycle connections after 30 min
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_schema_matches_models() -> None:
    """Read-only and warning-only: logs any table or column these models use
    that the database lacks (e.g. a reviewed schema change not applied in
    Supabase yet). Never blocks startup and never changes the schema —
    that's managed in Supabase (docs/DATABASE_SCHEMA_MANAGEMENT.md)."""
    log = logging.getLogger("uvicorn.error")
    try:
        with engine.connect() as conn:
            insp = inspect(conn)
            existing = set(insp.get_table_names())
            missing = []
            for table in Base.metadata.sorted_tables:
                if table.name not in existing:
                    missing.append(table.name)
                    continue
                present = {c["name"] for c in insp.get_columns(table.name)}
                missing += [f"{table.name}.{c.name}" for c in table.columns if c.name not in present]
    except Exception as exc:  # database unreachable — requests will report it
        log.warning("Could not compare the database schema with the models: %s", exc)
        return
    if missing:
        log.warning(
            "The database schema lacks what this service's models use: %s — apply the "
            "reviewed schema change in Supabase (docs/DATABASE_SCHEMA_MANAGEMENT.md).",
            ", ".join(missing),
        )
