from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth
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
    order.status = payload.status
    db.commit()
    db.refresh(order)
    return order
