"""The migration history (alembic/versions) must build exactly the schema the
models describe, and the integrity rules must hold in the database itself.
Runs against its own throwaway SQLite file (never the shared database).
"""
import os
import sys
import tempfile

# Alongside the other test files the app is already bound to their throwaway
# DB; this file uses its own engine either way.
if "app.database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'app.db')}"
    os.environ.pop("SECRET_KEY", None)

import pytest  # noqa: E402
from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app import models  # noqa: E402
from app.migrations import upgrade_to_head  # noqa: E402


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'schema.db')}")
    upgrade_to_head(eng)
    return eng


def test_migrations_build_exactly_the_models_schema(engine):
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        assert ctx.get_current_revision() == ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
        assert compare_metadata(ctx, models.Base.metadata) == []


def test_upgrade_is_idempotent(engine):
    upgrade_to_head(engine)  # already at head: nothing to do, no error


def _insert(engine, sql, **params):
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def test_order_numbers_and_coupon_codes_are_unique(engine):
    _insert(engine, "INSERT INTO customers (id, name, phone) VALUES ('g1', 'ضيف', '01000000001')")
    order = ("INSERT INTO orders (id, order_number, customer_id, customer_name, customer_phone, shipping_address, status, "
             "payment_method, subtotal, discount_amount, shipping_fee, total_amount) VALUES "
             "(:id, 'EB000001', 'g1', 'ضيف', '01000000001', 'عنوان', 'pending', 'cash_on_delivery', 0, 0, 0, 0)")
    _insert(engine, order, id="o1")
    with pytest.raises(IntegrityError):
        _insert(engine, order, id="o2")
    coupon = "INSERT INTO coupons (id, code, discount_type, discount_value, min_order_amount, used_count) VALUES (:id, 'SAME', 'fixed', 5, 0, 0)"
    _insert(engine, coupon, id="c1")
    with pytest.raises(IntegrityError):
        _insert(engine, coupon, id="c2")


def test_one_account_and_one_guest_profile_per_phone(engine):
    phone = "01000000002"
    _insert(engine, "INSERT INTO customers (id, name, phone) VALUES ('guest', 'ضيف', :p)", p=phone)
    # An account with the same phone is a separate identity — allowed.
    _insert(engine, "INSERT INTO customers (id, name, phone, hashed_password) VALUES ('acct', 'صاحبة الحساب', :p, 'x')", p=phone)
    with pytest.raises(IntegrityError):
        _insert(engine, "INSERT INTO customers (id, name, phone) VALUES ('guest2', 'ضيف تاني', :p)", p=phone)
    with pytest.raises(IntegrityError):
        _insert(engine, "INSERT INTO customers (id, name, phone, hashed_password) VALUES ('acct2', 'حساب تاني', :p, 'y')", p=phone)


def test_staff_usernames_are_unique(engine):
    _insert(engine, "INSERT INTO users (id, username, hashed_password) VALUES ('u1', 'admin', 'x')")
    with pytest.raises(IntegrityError):
        _insert(engine, "INSERT INTO users (id, username, hashed_password) VALUES ('u2', 'admin', 'y')")
