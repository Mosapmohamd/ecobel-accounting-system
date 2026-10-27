from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, order_ledger, promotions, schemas, auth, services
from ..database import get_db

router = APIRouter(prefix="/online-orders", tags=["Online Orders"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.OnlineOrderOut])
def list_online_orders(status: Optional[models.OrderStatus] = None, db: Session = Depends(get_db)):
    q = db.query(models.Order).options(joinedload(models.Order.items))
    if status:
        q = q.filter(models.Order.status == status)
    return q.order_by(models.Order.created_at.desc()).all()


@router.get("/{order_id}/status-history", response_model=List[schemas.OrderStatusChangeOut])
def order_status_history(order_id: str, db: Session = Depends(get_db)):
    if db.get(models.Order, order_id) is None:
        raise HTTPException(404, "الطلب غير موجود")
    return (
        db.query(models.OrderStatusChange)
        .filter(models.OrderStatusChange.order_id == order_id)
        .order_by(models.OrderStatusChange.created_at)
        .all()
    )


@router.patch("/{order_id}/status", response_model=schemas.OnlineOrderOut)
def update_order_status(
    order_id: str,
    payload: schemas.OnlineOrderStatusUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    """Staff set an order's status directly (the admin dropdown), within
    schemas.ORDER_TRANSITIONS. The order row is locked first, so concurrent
    or repeated requests serialize: the second sees the new status and is a
    no-op (same status) or a 409 (no longer allowed) — never a second
    reversal or restock. Every change is recorded in order_status_changes."""
    order = (
        db.query(models.Order)
        .options(joinedload(models.Order.items))
        .filter(models.Order.id == order_id)
        .with_for_update(of=models.Order)
        .first()
    )
    if not order:
        raise HTTPException(404, "الطلب غير موجود")
    if payload.status == order.status:
        return order
    if payload.status not in schemas.ORDER_TRANSITIONS[order.status]:
        raise HTTPException(409, "مينفعش الطلب يتنقل للحالة دي من حالته الحالية — يمكن حد تاني غيّرها، حدّث الصفحة")
    previous = order.status
    restored: dict = {}
    by = f"(من الإدارة: {user.username})"

    # Cancelling from here (staff side) needs the same cleanup the customer's
    # own cancellation does — give back the stock the order still holds, the
    # coupon and offer uses — since staff can cancel orders the customer never
    # touched (failed delivery, out of stock, etc.) — including a delivered
    # order (refused or returned: the goods are assumed back in stock). The
    # transition rules above (and the order row lock) mean this runs at most
    # once per order, and app/order_ledger.py only moves what is really still
    # held/recognized.
    if payload.status == models.OrderStatus.cancelled:
        restored = order_ledger.restore_stock(db, models, services, order, f"إلغاء طلب #{order.order_number} {by}")
        if order.coupon is not None and order.coupon.used_count > 0:
            order.coupon.used_count -= 1
        promotions.count_use(db, models, {op.promotion_id for op in order.applied_promotions}, -1)

    order.status = payload.status
    # Revenue follows the rule "completed AND paid" (app/order_ledger.py):
    # delivered (cash on delivery → paid) recognizes the order's total;
    # cancelled reverses whatever was recognized (nothing, for an order that
    # never was) — one entry for the difference, never a duplicate. Shipping
    # (or moving back to pending) changes neither, so it writes nothing.
    entry = None
    if order.status in (models.OrderStatus.delivered, models.OrderStatus.cancelled):
        entry = order_ledger.settle_revenue(
            db, models, order,
            f"طلب موقع #{order.order_number} — {'تم التوصيل والتحصيل' if order.status == models.OrderStatus.delivered else 'إلغاء'} {by}",
        )
    db.add(models.OrderStatusChange(
        order_id=order.id, from_status=previous.value, to_status=order.status.value, changed_by=user.username,
        revenue_change=0 if entry is None else (entry.amount if entry.type == models.FinanceEntryType.income else -entry.amount),
        units_restored=sum(restored.values()),
    ))
    db.commit()
    db.refresh(order)
    return order
