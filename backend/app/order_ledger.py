"""Website-order bookkeeping: revenue recognition / reversal and stock
restoration — the one place both systems change an order's money and stock
after checkout.

KEEP IDENTICAL in ecobel-website and ecobel-accounting-system (backend/app/
order_ledger.py; an accounting test compares the two files).

Revenue rule (docs/REVENUE.md in ecobel-accounting-system): a website order's
revenue is recognized only when the order is COMPLETED and PAID —
  completed = status "delivered";
  paid      = cash on delivery is collected when the order is delivered, so a
              delivered cash-on-delivery order is paid. Any other payment
              method has no payment confirmation in this system yet, so it is
              never counted as paid.
Recognition is a ledger entry: income, category SALE_CATEGORY, source
"website", reference_id = the order id. A recognized amount is taken back with
an expense entry in REVERSAL_CATEGORY (the existing cancellation convention).
Entries are never edited or deleted — corrections are new entries — so the
finance history stays auditable.

Every function here is idempotent: it moves the books / the stock from what
they ARE to what they should be, so a retry (or a second call) adds nothing.
Callers hold the order row lock (SELECT … FOR UPDATE) while calling them.
"""
from __future__ import annotations

SALE_CATEGORY = "مبيعات الموقع"
REVERSAL_CATEGORY = "إلغاء طلب موقع"
SOURCE = "website"
CASH_ON_DELIVERY = "cash_on_delivery"
_CENT = 0.005


def is_paid(order, models) -> bool:
    """Cash on delivery is paid when delivered; other methods have no
    payment confirmation yet, so they're never paid."""
    return order.payment_method == CASH_ON_DELIVERY and order.status == models.OrderStatus.delivered


def is_recognized(order, models) -> bool:
    """Completed AND paid — the only orders whose revenue counts."""
    return order.status == models.OrderStatus.delivered and is_paid(order, models)


def recognized_amount(db, models, order_id: str) -> float:
    """What the ledger currently recognizes for this order: its sale income
    minus its reversals."""
    from sqlalchemy import func

    def total(entry_type, category):
        return float(
            db.query(func.coalesce(func.sum(models.FinanceEntry.amount), 0))
            .filter(models.FinanceEntry.reference_id == order_id)
            .filter(models.FinanceEntry.source == SOURCE)
            .filter(models.FinanceEntry.type == entry_type)
            .filter(models.FinanceEntry.category == category)
            .scalar() or 0
        )

    return round(total(models.FinanceEntryType.income, SALE_CATEGORY) - total(models.FinanceEntryType.expense, REVERSAL_CATEGORY), 2)


def settle_revenue(db, models, order, note: str):
    """Brings the order's recognized revenue to what the rule says it should
    be — its total when completed and paid, otherwise 0 — with ONE new entry
    for the difference (income up, reversal down), or none at all when the
    books already agree. So: cancelling an order that never recognized revenue
    writes nothing; cancelling one that did reverses it exactly once; a retry
    writes nothing. Returns the new entry or None."""
    target = round(order.total_amount, 2) if is_recognized(order, models) else 0.0
    diff = round(target - recognized_amount(db, models, order.id), 2)
    if abs(diff) < _CENT:
        return None
    entry = models.FinanceEntry(
        type=models.FinanceEntryType.income if diff > 0 else models.FinanceEntryType.expense,
        category=SALE_CATEGORY if diff > 0 else REVERSAL_CATEGORY,
        amount=abs(diff),
        description=note,
        reference_id=order.id,
        source=SOURCE,
    )
    db.add(entry)
    return entry


def deducted_stock(db, models, order_id: str) -> dict[str, int]:
    """product_id -> units this order currently holds out of stock, from its
    own inventory movements (checkout and edits deduct, cancellations and
    edits give back). Only what was really deducted can come back."""
    from sqlalchemy import func

    rows = (
        db.query(models.InventoryMovement.product_id, func.coalesce(func.sum(models.InventoryMovement.quantity_change), 0))
        .filter(models.InventoryMovement.reference_id == order_id)
        .filter(models.InventoryMovement.type == models.MovementType.website_sale)
        .group_by(models.InventoryMovement.product_id)
        .all()
    )
    return {pid: -int(net) for pid, net in rows if net < 0}


def restore_stock(db, models, services, order, note: str) -> dict[str, int]:
    """Gives back exactly the units the order still holds — each product
    once, its row locked (in id order, like checkout) so a concurrent sale
    can't overwrite the change. Nothing held (never deducted, or already
    given back) → nothing changes. Returns product_id -> units returned."""
    held = deducted_stock(db, models, order.id)
    if not held:
        return {}
    products = (
        db.query(models.Product)
        .filter(models.Product.id.in_(sorted(held)))
        .order_by(models.Product.id)
        .with_for_update()
        .populate_existing()  # read stock as it is now that the rows are locked
        .all()
    )
    for product in products:
        services.apply_stock_movement(
            db, product, held[product.id], models.MovementType.website_sale,
            reference_id=order.id, note=note,
        )
    return {p.id: held[p.id] for p in products}
