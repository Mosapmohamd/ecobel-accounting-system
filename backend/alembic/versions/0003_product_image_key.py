"""Products reference their photo by storage key, not by URL.

products.image_url held a URL path that only made sense on the server that
wrote it ("/static/products/<file>" on the accounting backend), so the
storefront could never load it. It becomes products.image_key: the
provider-neutral key of the object in the product-images storage bucket
("products/<product_id>/<random>.<ext>"). Both services turn the key into a
public URL from one configured base (see app/product_images.py), so the
same row works in every environment.

Existing values: a value that is already a storage key is kept; anything
else (legacy service-relative paths, whose files aren't in storage) is
cleared — that product shows the standard fallback until a photo is
uploaded again. The shared development database had none.

Revision ID: 0003_product_image_key
Revises: 0002_integrity
Create Date: 2026-10-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_product_image_key"
down_revision: Union[str, Sequence[str], None] = "0002_integrity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("products") as batch_op:
        batch_op.alter_column("image_url", new_column_name="image_key", existing_type=sa.String(), existing_nullable=True)
    cleared = op.get_bind().execute(
        sa.text("UPDATE products SET image_key = NULL WHERE image_key IS NOT NULL AND image_key NOT LIKE 'products/%'")
    ).rowcount
    if cleared:
        print(f"0003_product_image_key: cleared {cleared} legacy product image path(s); re-upload those photos.")


def downgrade() -> None:
    # Keys aren't URLs; the old column held URL paths, so they're not restored.
    op.execute("UPDATE products SET image_key = NULL")
    with op.batch_alter_table("products") as batch_op:
        batch_op.alter_column("image_key", new_column_name="image_url", existing_type=sa.String(), existing_nullable=True)
