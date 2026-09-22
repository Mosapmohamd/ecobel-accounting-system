import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

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
