"""Integrity: the constraints and indexes the models always declared.

- orders.order_number, coupons.code, users.username: unique (+ index).
  Application code already checked these; the database now guarantees
  them (e.g. two concurrent checkouts can no longer share an order number).
- customers.phone: lookup index, plus at most one *account* and one *guest
  profile* per phone (partial unique indexes). A guest profile and an
  account are separate identities — see the Customer model.
- b2b_orders.extra_discount_percentage: NOT NULL (schema_sync backfilled 0).
- The legacy-value fixes app/schema_sync.py used to apply on every start
  (old order statuses, English category names) — idempotent, so a no-op
  on a database that already had them.

Every step fails loudly instead of deleting data if existing rows violate
it (e.g. duplicate order numbers would abort the upgrade untouched).

Revision ID: 0002_integrity
Revises: 0001_baseline
Create Date: 2026-10-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_integrity"
down_revision: Union[str, Sequence[str], None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LEGACY_VALUES = [
    ("orders", "status", "completed", "delivered"),
    ("orders", "status", "refunded", "cancelled"),
    ("orders", "status", "processing", "pending"),
    ("categories", "name", "Skin Care", "العناية بالبشرة"),
    ("categories", "name", "Hair Care", "العناية بالشعر"),
    ("categories", "name", "Body Care", "العناية بالجسم"),
    ("categories", "name", "Men's Care", "العناية بالرجال"),
    ("categories", "name", "Bath & Shower", "الاستحمام والعناية"),
    ("categories", "name", "Gift & Wellness", "الهدايا والعافية"),
]


def upgrade() -> None:
    for table, column, old, new in _LEGACY_VALUES:
        op.execute(
            sa.text(f"UPDATE {table} SET {column} = :new WHERE CAST({column} AS TEXT) = :old").bindparams(new=new, old=old)
        )
    op.execute("UPDATE b2b_orders SET extra_discount_percentage = 0 WHERE extra_discount_percentage IS NULL")

    with op.batch_alter_table("orders") as batch_op:
        batch_op.create_index("ix_orders_order_number", ["order_number"], unique=True)
    with op.batch_alter_table("coupons") as batch_op:
        batch_op.create_index("ix_coupons_code", ["code"], unique=True)
    with op.batch_alter_table("users") as batch_op:
        batch_op.create_index("ix_users_username", ["username"], unique=True)
    with op.batch_alter_table("customers") as batch_op:
        batch_op.create_index("ix_customers_phone", ["phone"], unique=False)
        batch_op.create_index(
            "uq_customers_account_phone", ["phone"], unique=True,
            postgresql_where=sa.text("hashed_password IS NOT NULL"), sqlite_where=sa.text("hashed_password IS NOT NULL"),
        )
        batch_op.create_index(
            "uq_customers_guest_phone", ["phone"], unique=True,
            postgresql_where=sa.text("hashed_password IS NULL"), sqlite_where=sa.text("hashed_password IS NULL"),
        )
    with op.batch_alter_table("b2b_orders") as batch_op:
        batch_op.alter_column("extra_discount_percentage", existing_type=sa.Float(), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("b2b_orders") as batch_op:
        batch_op.alter_column("extra_discount_percentage", existing_type=sa.Float(), nullable=True)
    with op.batch_alter_table("customers") as batch_op:
        batch_op.drop_index("uq_customers_guest_phone")
        batch_op.drop_index("uq_customers_account_phone")
        batch_op.drop_index("ix_customers_phone")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_index("ix_users_username")
    with op.batch_alter_table("coupons") as batch_op:
        batch_op.drop_index("ix_coupons_code")
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_index("ix_orders_order_number")
    # The legacy-value renames are not reversed (they were never reversible).
