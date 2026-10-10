"""Shared state for abuse limits that must hold across server processes.

orders.client_ip_hash — HMAC of a guest checkout's IP address, written by
ecobel-website for guest (not signed-in) orders, so it can cap guest orders
per IP per day (app/abuse_limits.py there). The raw address is never stored.
Existing orders keep NULL.

auth_throttle — failed sign-in counters per account identifier, shared by
customer sign-in (storefront) and staff sign-in (this service). Keys are
HMACs of "<namespace>:<identifier>"; rows expire by time and are reset by a
successful sign-in.

Additive only: no existing data changes.

Revision ID: 0004_abuse_controls
Revises: 0003_product_image_key
Create Date: 2026-10-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_abuse_controls"
down_revision: Union[str, Sequence[str], None] = "0003_product_image_key"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(sa.Column("client_ip_hash", sa.String(length=64), nullable=True))
        batch_op.create_index("ix_orders_client_ip_hash", ["client_ip_hash"])
    op.create_table(
        "auth_throttle",
        sa.Column("key", sa.String(length=64), primary_key=True),
        sa.Column("failures", sa.Integer(), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("auth_throttle")
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_index("ix_orders_client_ip_hash")
        batch_op.drop_column("client_ip_hash")
