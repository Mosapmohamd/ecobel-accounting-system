import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Default to local SQLite for development/testing.
# In production, set DATABASE_URL to a PostgreSQL connection string, e.g.:
#   postgresql://ecobel_user:password@localhost:5432/ecobel_db
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./ecobel_dev.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
