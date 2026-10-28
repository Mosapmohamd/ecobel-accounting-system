"""Customer returns on website orders (staff). The rules live in
app/returns.py; this router validates input, locks the order and records."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .. import auth, cairo_time, models, returns, schemas
from ..database import get_db

router = APIRouter(prefix="/online-orders", tags=["Online Order Returns"], dependencies=[Depends(auth.get_current_user)])


def _order(db: Session, order_id: str, lock: bool = False) -> models.Order:
    q = db.query(models.Order).options(joinedload(models.Order.items)).filter(models.Order.id == order_id)
    if lock:
        q = q.with_for_update(of=models.Order).populate_existing()
    order = q.first()
    if not order:
        raise HTTPException(404, "الطلب غير موجود")
    return order


def _check_date(order: models.Order, payload: schemas.ReturnIn) -> None:
    if payload.returned_on > cairo_time.cairo_today():
        raise HTTPException(400, "تاريخ المرتجع مينفعش يكون في المستقبل")
    if payload.returned_on < returns_date_floor(order):
        raise HTTPException(400, "تاريخ المرتجع قبل تاريخ الطلب")


def returns_date_floor(order: models.Order):
    return cairo_time.as_utc(order.created_at).astimezone(cairo_time.CAIRO).date()


def _plan(db: Session, order: models.Order, payload: schemas.ReturnIn) -> returns.ReturnPlan:
    try:
        return returns.plan_return(db, order, [(i.order_item_id, i.quantity, i.restock) for i in payload.items])
    except returns.ReturnError as e:
        raise HTTPException(409, str(e))


@router.get("/{order_id}/returns", response_model=schemas.OrderReturnsSummary)
def order_returns(order_id: str, db: Session = Depends(get_db)):
    """What was ordered, returned and restocked per line, what's still
    returnable, and every return recorded on the order."""
    order = _order(db, order_id)
    recorded = (
        db.query(models.OrderReturn).options(joinedload(models.OrderReturn.items))
        .filter(models.OrderReturn.order_id == order.id).order_by(models.OrderReturn.created_at).all()
    )
    returned: dict = {}
    restocked: dict = {}
    for r in recorded:
        for it in r.items:
            returned[it.order_item_id] = returned.get(it.order_item_id, 0) + it.quantity
            if it.restock:
                restocked[it.order_item_id] = restocked.get(it.order_item_id, 0) + it.quantity
    units = returns.unit_values(db, order)
    lines = [
        schemas.ReturnableLine(
            order_item_id=it.id, product_id=it.product_id, product_name=it.product_name, ordered=it.quantity,
            returned=returned.get(it.id, 0), restocked=restocked.get(it.id, 0),
            returnable=it.quantity - returned.get(it.id, 0), unit_value=round(units[it.id], 2),
        )
        for it in order.items
    ]
    delivered = order.status == models.OrderStatus.delivered
    left = sum(l.returnable for l in lines)
    return schemas.OrderReturnsSummary(
        order_id=order.id, status=order.status,
        can_return=delivered and left > 0,
        reason_if_not=None if delivered and left > 0 else (
            "كل قطع الطلب رجعت بالفعل" if delivered else "المرتجع بيتسجل على طلب اتسلّم بس"),
        lines=lines, returns=recorded,
        merchandise_total=returns.merchandise_total(order),
        merchandise_returned=round(sum(r.merchandise_value for r in recorded), 2),
        revenue_reversed=round(sum(r.revenue_reversed for r in recorded), 2),
        shipping_fee=order.shipping_fee or 0, fully_returned=bool(lines) and left == 0,
    )


@router.post("/{order_id}/returns/preview", response_model=schemas.ReturnPreview)
def preview_return(order_id: str, payload: schemas.ReturnIn, db: Session = Depends(get_db)):
    """The quantities, stock and money a return would move — changes nothing."""
    order = _order(db, order_id)
    _check_date(order, payload)
    plan = _plan(db, order, payload)
    return _preview(plan)


def _preview(plan: returns.ReturnPlan) -> schemas.ReturnPreview:
    return schemas.ReturnPreview(
        lines=[schemas.ReturnPreviewLine(order_item_id=l.item.id, product_name=l.item.product_name, quantity=l.quantity,
                                         restock=l.restock, amount=l.amount) for l in plan.lines],
        units=plan.units, units_restocked=plan.units_restocked,
        merchandise_value=plan.merchandise_value, revenue_reversed=plan.revenue_reversed,
    )


@router.post("/{order_id}/returns", response_model=schemas.OrderReturnOut, status_code=201)
def create_return(
    order_id: str,
    payload: schemas.ReturnCreate,
    response: Response,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    """Records a return. The order row lock serializes returns on one order
    (no over-returning); the request_id makes a retried submission return
    the return already recorded (200) instead of a second one."""
    order = _order(db, order_id, lock=True)
    existing = db.query(models.OrderReturn).filter(models.OrderReturn.request_id == payload.request_id).first()
    if existing is not None:
        if existing.order_id != order.id:
            raise HTTPException(409, "رقم الطلب ده (request_id) مستخدم لمرتجع تاني")
        response.status_code = 200
        return existing
    _check_date(order, payload)
    plan = _plan(db, order, payload)
    ret = returns.apply_return(
        db, order, plan, request_id=payload.request_id, reason=payload.reason.strip(),
        note=(payload.note or "").strip() or None, returned_on=payload.returned_on, processed_by=user.username,
    )
    try:
        db.commit()
    except IntegrityError:  # the same request_id committed by a parallel retry
        db.rollback()
        existing = db.query(models.OrderReturn).filter(models.OrderReturn.request_id == payload.request_id).first()
        if existing is None or existing.order_id != order_id:
            raise
        response.status_code = 200
        return existing
    db.refresh(ret)
    return ret
