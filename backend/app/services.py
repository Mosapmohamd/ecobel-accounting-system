from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import models


def apply_stock_movement(
    db: Session,
    product: models.Product,
    quantity_change: int,
    movement_type: models.MovementType,
    reference_id: str | None = None,
    note: str | None = None,
    allow_negative: bool = False,
) -> models.InventoryMovement:
    """Creates an InventoryMovement row and updates the product's cached
    quantity in the same transaction. Raises if the change would take stock
    negative (unless allow_negative=True, used for manual corrections)."""
    new_quantity = product.quantity + quantity_change
    if new_quantity < 0 and not allow_negative:
        raise HTTPException(
            400,
            f"الكمية المتاحة من '{product.name}' غير كافية "
            f"(المتاح: {product.quantity}, المطلوب خصمه: {abs(quantity_change)})",
        )

    product.quantity = new_quantity
    movement = models.InventoryMovement(
        product_id=product.id,
        type=movement_type,
        quantity_change=quantity_change,
        reference_id=reference_id,
        note=note,
    )
    db.add(movement)
    return movement
