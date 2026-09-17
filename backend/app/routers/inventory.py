from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth, services
from ..database import get_db

router = APIRouter(prefix="/inventory", tags=["Inventory"], dependencies=[Depends(auth.get_current_user)])


@router.post("/adjust", response_model=schemas.InventoryMovementOut, status_code=201)
def adjust_stock(payload: schemas.StockAdjustment, db: Session = Depends(get_db)):
    """Manual stock adjustment: positive quantity_change = restock,
    negative = correction/damage/loss. Always allowed to go negative here
    since it's an explicit manual override (e.g. fixing a count error)."""
    product = db.get(models.Product, payload.product_id)
    if not product:
        raise HTTPException(404, "المنتج غير موجود")

    movement_type = models.MovementType.restock if payload.quantity_change > 0 else models.MovementType.adjustment
    movement = services.apply_stock_movement(
        db, product, payload.quantity_change, movement_type,
        note=payload.note, allow_negative=True,
    )
    db.commit()
    db.refresh(movement)
    return movement


@router.get("/movements", response_model=List[schemas.InventoryMovementOut])
def list_movements(
    product_id: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    q = db.query(models.InventoryMovement)
    if product_id:
        q = q.filter(models.InventoryMovement.product_id == product_id)
    return q.order_by(models.InventoryMovement.created_at.desc()).limit(limit).all()
