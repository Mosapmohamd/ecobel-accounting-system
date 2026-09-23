from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth, services
from ..database import get_db

router = APIRouter(prefix="/online-orders", tags=["Online Orders"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.OnlineOrderOut])
def list_online_orders(status: Optional[models.OrderStatus] = None, db: Session = Depends(get_db)):
    q = db.query(models.Order).options(joinedload(models.Order.items))
    if status:
        q = q.filter(models.Order.status == status)
    return q.order_by(models.Order.created_at.desc()).all()


@router.patch("/{order_id}/status", response_model=schemas.OnlineOrderOut)
def update_order_status(order_id: str, payload: schemas.OnlineOrderStatusUpdate, db: Session = Depends(get_db)):
    order = (
        db.query(models.Order)
        .options(joinedload(models.Order.items))
        .filter(models.Order.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(404, "الطلب غير موجود")

    # Cancelling from here (staff side) needs the same cleanup the customer's
    # own cancellation does — release the reserved stock and reverse the
    # revenue — since staff can cancel orders the customer never touched
    # (failed delivery, out of stock, etc.). Guarded so re-saving an
    # already-cancelled order doesn't double-release stock or double-reverse.
    if payload.status == models.OrderStatus.cancelled and order.status != models.OrderStatus.cancelled:
        for item in order.items:
            product = db.get(models.Product, item.product_id)
            if product:
                services.apply_stock_movement(
                    db, product, item.quantity, models.MovementType.website_sale,
                    reference_id=order.id, note=f"إلغاء طلب #{order.order_number} (من الإدارة)",
                )
        db.add(models.FinanceEntry(
            type=models.FinanceEntryType.expense,
            category="إلغاء طلب موقع",
            amount=order.total_amount,
            description=f"إلغاء طلب #{order.order_number} (من الإدارة)",
            reference_id=order.id,
            source="website",
        ))

    order.status = payload.status
    db.commit()
    db.refresh(order)
    return order
