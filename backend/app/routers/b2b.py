from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth, services
from ..database import get_db

router = APIRouter(prefix="/b2b", tags=["B2B"], dependencies=[Depends(auth.get_current_user)])

FINANCE_CATEGORY = "مبيعات جملة B2B"


def _combined_discount(customer_discount: float, extra_discount: float) -> float:
    """The customer's standing discount plus the order's one-time extra
    discount, capped at 100%."""
    return min(100, customer_discount + extra_discount)


def _line_total(unit_price: float, quantity: int, combined_discount: float) -> float:
    return unit_price * quantity * (1 - combined_discount / 100)


# ---------------- Customers ----------------
@router.get("/customers", response_model=List[schemas.B2BCustomerOut])
def list_customers(
    order: Literal["name", "newest"] = "name",
    limit: Optional[int] = Query(None, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """By name (default — e.g. for pickers) or newest first; `limit` caps
    the list (the B2B page asks for one more than it shows, to know if
    there are more)."""
    q = db.query(models.B2BCustomer)
    if order == "newest":
        q = q.order_by(models.B2BCustomer.created_at.desc(), models.B2BCustomer.id.desc())
    else:
        q = q.order_by(models.B2BCustomer.name, models.B2BCustomer.id)
    return q.limit(limit).all()


@router.post("/customers", response_model=schemas.B2BCustomerOut, status_code=201)
def create_customer(payload: schemas.B2BCustomerCreate, db: Session = Depends(get_db)):
    customer = models.B2BCustomer(**payload.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/customers/{customer_id}", response_model=schemas.B2BCustomerOut)
def get_customer(customer_id: str, db: Session = Depends(get_db)):
    """One customer; their orders come from GET /b2b/orders?customer_id=…"""
    customer = db.get(models.B2BCustomer, customer_id)
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    return customer


@router.patch("/customers/{customer_id}", response_model=schemas.B2BCustomerOut)
def update_customer(customer_id: str, payload: schemas.B2BCustomerUpdate, db: Session = Depends(get_db)):
    """Edit a customer. A new discount applies to orders created from now on;
    existing orders keep the discount they were priced with."""
    customer = db.get(models.B2BCustomer, customer_id)
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return customer


@router.delete("/customers/{customer_id}", status_code=204)
def delete_customer(customer_id: str, db: Session = Depends(get_db)):
    """Delete a customer who has no orders. A customer with orders can't be
    deleted: the orders (and their stock and finance records) belong to the
    business history. There's no "inactive" state for customers."""
    customer = (
        db.query(models.B2BCustomer).filter(models.B2BCustomer.id == customer_id).with_for_update().one_or_none()
    )
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    orders = db.query(models.B2BOrder).filter(models.B2BOrder.customer_id == customer.id).count()
    if orders:
        raise HTTPException(
            409,
            f"مينفعش تمسح «{customer.name}» — عليه {orders} أوردر مسجّل، والأوردرات دي جزء من سجل المبيعات "
            "والمخزون والحسابات. لو مش هتتعامل معاه تاني سيبه زي ما هو، ولو الأوردرات اتسجلت غلط امسحها الأول.",
        )
    db.delete(customer)
    db.commit()


# ---------------- Orders ----------------
@router.get("/orders", response_model=List[schemas.B2BOrderOut])
def list_orders(
    customer_id: str | None = None,
    limit: Optional[int] = Query(None, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Newest first (ties broken by id, so the order is stable); `limit`
    caps the list."""
    q = db.query(models.B2BOrder).options(joinedload(models.B2BOrder.items), joinedload(models.B2BOrder.customer))
    if customer_id:
        q = q.filter(models.B2BOrder.customer_id == customer_id)
    return q.order_by(models.B2BOrder.created_at.desc(), models.B2BOrder.id.desc()).limit(limit).all()


@router.get("/orders/{order_id}", response_model=schemas.B2BOrderOut)
def get_order(order_id: str, db: Session = Depends(get_db)):
    order = db.get(models.B2BOrder, order_id)
    if not order:
        raise HTTPException(404, "الأوردر غير موجود")
    return order


@router.post("/orders", response_model=schemas.B2BOrderOut, status_code=201)
def create_order(payload: schemas.B2BOrderCreate, db: Session = Depends(get_db)):
    customer = db.get(models.B2BCustomer, payload.customer_id)
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    if not payload.items:
        raise HTTPException(400, "الأوردر لازم يحتوي على منتج واحد على الأقل")

    order = models.B2BOrder(
        customer_id=customer.id, note=payload.note, total_amount=0,
        extra_discount_percentage=payload.extra_discount_percentage,
    )
    db.add(order)
    db.flush()  # get order.id without committing

    # The customer's standing discount always applies, plus an optional
    # one-time extra discount entered manually for this order only — it's
    # never saved back to the customer's profile.
    combined_discount = _combined_discount(customer.discount_percentage, payload.extra_discount_percentage)

    total = 0.0
    for item_in in payload.items:
        product = db.get(models.Product, item_in.product_id)
        if not product:
            raise HTTPException(404, f"منتج غير موجود: {item_in.product_id}")
        if item_in.quantity <= 0:
            raise HTTPException(400, "الكمية لازم تكون أكبر من صفر")

        line_total = _line_total(product.sale_price, item_in.quantity, combined_discount)
        total += line_total

        order_item = models.B2BOrderItem(
            order_id=order.id,
            product_id=product.id,
            quantity=item_in.quantity,
            unit_price=product.sale_price,
            discount_percentage=combined_discount,
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
        category=FINANCE_CATEGORY,
        amount=total,
        description=f"أوردر B2B — {customer.name}",
        reference_id=order.id,
        source="b2b",
    )
    db.add(finance_entry)

    db.commit()
    db.refresh(order)
    return order


def _locked_order(db: Session, order_id: str) -> models.B2BOrder:
    """The order with a row lock (held until commit), so an edit or delete
    of the same order can't run twice at once."""
    order = (
        db.query(models.B2BOrder)
        .options(joinedload(models.B2BOrder.items), joinedload(models.B2BOrder.customer))
        .filter(models.B2BOrder.id == order_id)
        .with_for_update(of=models.B2BOrder)
        .one_or_none()
    )
    if not order:
        raise HTTPException(404, "الأوردر غير موجود")
    return order


def _locked_products(db: Session, product_ids) -> dict[str, models.Product]:
    """Products about to have their stock changed, locked in id order (a
    fixed order, so two requests can't deadlock each other)."""
    ids = sorted(set(product_ids))
    rows = db.query(models.Product).filter(models.Product.id.in_(ids)).order_by(models.Product.id).with_for_update().all()
    return {p.id: p for p in rows}


@router.put("/orders/{order_id}", response_model=schemas.B2BOrderOut)
def update_order(order_id: str, payload: schemas.B2BOrderUpdate, db: Session = Depends(get_db)):
    """Edit an order's products, quantities, note and one-time extra discount
    (the customer can't change). Everything happens in one transaction:

    * Prices: lines already in the order keep the unit price they were sold
      at; a newly added product is priced at today's price.
    * Discount: the customer part stays what it was when the order was
      placed (stored discount − extra discount), not today's customer
      discount; only the extra part follows this edit.
    * Stock: only the difference per product is moved (b2b_sale movements
      referencing the order).
    * Finance: one entry for the change in total — income if it grew,
      expense if it shrank — so the ledger keeps its history.

    Sending the same edit again changes nothing (no stock or finance entries)."""
    order = _locked_order(db, order_id)
    new_quantities: dict[str, int] = {}
    for item in payload.items:
        if item.product_id in new_quantities:
            raise HTTPException(400, "نفس المنتج متكرر في الأوردر — اجمع الكمية في سطر واحد")
        new_quantities[item.product_id] = item.quantity

    old_lines = {item.product_id: item for item in order.items}
    stored_discount = order.items[0].discount_percentage if order.items else order.customer.discount_percentage + order.extra_discount_percentage
    extra_changed = payload.extra_discount_percentage != order.extra_discount_percentage
    if extra_changed and stored_discount >= 100:
        raise HTTPException(
            409,
            "الخصم الكلي على الأوردر ده وصل ١٠٠٪، فمش ممكن نعرف خصم العميل وقت الأوردر بدقة — "
            "الخصم الإضافي مينفعش يتعدّل هنا. عدّل المنتجات أو الكميات بس، أو امسح الأوردر واعمله من جديد.",
        )
    customer_part = stored_discount - order.extra_discount_percentage
    combined = _combined_discount(customer_part, payload.extra_discount_percentage) if extra_changed else stored_discount

    products = _locked_products(db, list(old_lines) + list(new_quantities))
    for pid, qty in new_quantities.items():
        product = products.get(pid)
        if product is None:
            raise HTTPException(404, f"منتج غير موجود: {pid}")
        if not product.is_active and qty > (old_lines[pid].quantity if pid in old_lines else 0):
            raise HTTPException(400, f"«{product.name}» مؤرشف — مينفعش تزوّد كميته أو تضيفه لأوردر")

    old_total = order.total_amount
    # Stock: move only the difference per product (sold more → out, less → back in).
    for pid in sorted(set(old_lines) | set(new_quantities)):
        delta = new_quantities.get(pid, 0) - (old_lines[pid].quantity if pid in old_lines else 0)
        if delta and pid in products:
            services.apply_stock_movement(
                db, products[pid], -delta, models.MovementType.b2b_sale,
                reference_id=order.id, note=f"تعديل أوردر جملة — {order.customer.name}",
            )

    # Lines: keep historical unit prices, re-price with the (possibly new) discount.
    total = 0.0
    for pid, line in old_lines.items():
        if pid not in new_quantities:
            order.items.remove(line)
    for pid, qty in new_quantities.items():
        line = old_lines.get(pid)
        if line is None:
            line = models.B2BOrderItem(product_id=pid, unit_price=products[pid].sale_price)
            order.items.append(line)
        line.quantity = qty
        line.discount_percentage = combined
        line.line_total = _line_total(line.unit_price, qty, combined)
        total += line.line_total

    order.total_amount = total
    order.note = payload.note
    order.extra_discount_percentage = payload.extra_discount_percentage

    difference = round(total - old_total, 2)
    if difference:
        db.add(models.FinanceEntry(
            type=models.FinanceEntryType.income if difference > 0 else models.FinanceEntryType.expense,
            category=FINANCE_CATEGORY if difference > 0 else "تعديل أوردر جملة B2B",
            amount=abs(difference),
            description=f"تعديل أوردر B2B — {order.customer.name} (من {old_total:g} إلى {total:g})",
            reference_id=order.id,
            source="b2b",
        ))
    db.commit()
    db.refresh(order)
    return order


@router.delete("/orders/{order_id}", status_code=204)
def delete_order(order_id: str, db: Session = Depends(get_db)):
    """Cancel an order the way website orders are cancelled: its stock goes
    back (b2b_sale movements referencing the order) and its revenue is
    reversed with an expense entry — the original movements and income stay
    in the ledgers as history. Then the order itself is removed, so sales
    reports stop counting it. All in one transaction; a repeated request
    finds no order (404) and reverses nothing twice."""
    order = _locked_order(db, order_id)
    products = _locked_products(db, [item.product_id for item in order.items])
    for item in order.items:
        product = products.get(item.product_id)
        if product:
            services.apply_stock_movement(
                db, product, item.quantity, models.MovementType.b2b_sale,
                reference_id=order.id, note=f"إلغاء أوردر جملة — {order.customer.name}",
            )
    if order.total_amount:
        db.add(models.FinanceEntry(
            type=models.FinanceEntryType.expense,
            category="إلغاء أوردر جملة B2B",
            amount=order.total_amount,
            description=f"إلغاء أوردر B2B — {order.customer.name}",
            reference_id=order.id,
            source="b2b",
        ))
    db.delete(order)
    db.commit()
