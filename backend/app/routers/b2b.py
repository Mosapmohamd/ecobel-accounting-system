from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth, services
from ..database import get_db

router = APIRouter(prefix="/b2b", tags=["B2B"], dependencies=[Depends(auth.get_current_user)])


# ---------------- Customers ----------------
@router.get("/customers", response_model=List[schemas.B2BCustomerOut])
def list_customers(db: Session = Depends(get_db)):
    return db.query(models.B2BCustomer).order_by(models.B2BCustomer.name).all()


@router.post("/customers", response_model=schemas.B2BCustomerOut, status_code=201)
def create_customer(payload: schemas.B2BCustomerCreate, db: Session = Depends(get_db)):
    customer = models.B2BCustomer(**payload.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.patch("/customers/{customer_id}", response_model=schemas.B2BCustomerOut)
def update_customer(customer_id: str, payload: schemas.B2BCustomerUpdate, db: Session = Depends(get_db)):
    customer = db.get(models.B2BCustomer, customer_id)
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return customer


# ---------------- Orders ----------------
@router.get("/orders", response_model=List[schemas.B2BOrderOut])
def list_orders(customer_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(models.B2BOrder).options(joinedload(models.B2BOrder.items))
    if customer_id:
        q = q.filter(models.B2BOrder.customer_id == customer_id)
    return q.order_by(models.B2BOrder.created_at.desc()).all()


@router.post("/orders", response_model=schemas.B2BOrderOut, status_code=201)
def create_order(payload: schemas.B2BOrderCreate, db: Session = Depends(get_db)):
    customer = db.get(models.B2BCustomer, payload.customer_id)
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    if not payload.items:
        raise HTTPException(400, "الأوردر لازم يحتوي على منتج واحد على الأقل")

    order = models.B2BOrder(customer_id=customer.id, note=payload.note, total_amount=0)
    db.add(order)
    db.flush()  # get order.id without committing

    total = 0.0
    for item_in in payload.items:
        product = db.get(models.Product, item_in.product_id)
        if not product:
            raise HTTPException(404, f"منتج غير موجود: {item_in.product_id}")
        if item_in.quantity <= 0:
            raise HTTPException(400, "الكمية لازم تكون أكبر من صفر")

        # Discount is always the customer's fixed, pre-agreed rate — applied
        # automatically, never entered manually per order.
        discount = customer.discount_percentage
        line_total = product.sale_price * item_in.quantity * (1 - discount / 100)
        total += line_total

        order_item = models.B2BOrderItem(
            order_id=order.id,
            product_id=product.id,
            quantity=item_in.quantity,
            unit_price=product.sale_price,
            discount_percentage=discount,
            line_total=line_total,
        )
        db.add(order_item)

        # Deduct stock for this order
        services.apply_stock_movement(
            db, product, -item_in.quantity, models.MovementType.b2b_sale,
            reference_id=order.id, note=f"B2B order to {customer.name}",
        )

    order.total_amount = total

    # Record the revenue as a finance entry automatically
    finance_entry = models.FinanceEntry(
        type=models.FinanceEntryType.income,
        category="مبيعات جملة B2B",
        amount=total,
        description=f"أوردر B2B — {customer.name}",
        reference_id=order.id,
    )
    db.add(finance_entry)

    db.commit()
    db.refresh(order)
    return order
