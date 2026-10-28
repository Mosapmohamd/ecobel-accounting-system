"""Customer returns on website orders — explicit, per item, partial or full.
See docs/REVENUE.md («Returns»).

A return is recorded against a DELIVERED order (an order that never reached
the customer is cancelled instead). For each order line staff give the units
that came back and whether they can be sold again:

- Stock: only units marked restockable go back, as one `customer_return`
  inventory movement per product (reference_id = the order). Nothing is
  restocked for damaged units, and nothing beyond what was returned.
- Revenue: if the order's revenue was recognized (delivered + cash on
  delivery, app/order_ledger.py), the returned merchandise value is reversed
  with one expense entry in RETURN_CATEGORY (source "website", reference_id =
  the order) — a revenue reversal, not an operating expense. The original
  sale entry stays. Shipping is not refunded.
- Value of a returned unit = what the customer actually paid for it: the
  line's price, minus the offer discount allocated to that product at
  checkout (order_promotions.details.allocations), minus the coupon spread
  over the lines in proportion to their value after offers. The cumulative
  value of everything returned so far is rounded once, so returning every
  unit reverses exactly the order's merchandise total (total − shipping).

Each return carries a client-generated request_id (unique): a retried request
returns the return already recorded instead of adding another. Callers hold
the order row lock (SELECT … FOR UPDATE), which serializes concurrent returns
on one order, so remaining quantities can't be over-returned.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import func

from . import models, order_ledger, services

RETURN_CATEGORY = "مرتجع طلب موقع"
_CENT = 0.005


def _r(x: float) -> float:
    return round(x + 0.0, 2)


# ---------------------------------------------------------------- what a unit is worth
def unit_values(db, order: models.Order) -> dict[str, float]:
    """order_item_id -> what the customer paid for ONE unit of that line,
    after offers and coupon (unrounded, so cumulative sums stay exact)."""
    lines = list(order.items)
    gross_by_product: dict[str, float] = defaultdict(float)
    for it in lines:
        gross_by_product[it.product_id] += it.line_total

    # Offer discounts, as allocated per product when the order was placed.
    allocated: dict[str, float] = defaultdict(float)
    for row in db.query(models.OrderPromotion).filter(models.OrderPromotion.order_id == order.id).all():
        for pid, amount in ((row.details or {}).get("allocations") or {}).items():
            if pid in gross_by_product:
                allocated[pid] += float(amount or 0)
    promo_total = max(float(order.promotion_discount or 0), 0.0)
    allocated = {pid: min(a, gross_by_product[pid]) for pid, a in allocated.items()}
    alloc_sum = sum(allocated.values())
    if alloc_sum > promo_total + _CENT:  # never take more than the order's offer discount
        allocated = {pid: a * promo_total / alloc_sum for pid, a in allocated.items()}
        alloc_sum = promo_total
    # Any offer discount not allocated to a product (older orders) is spread by value.
    residual = max(promo_total - alloc_sum, 0.0)
    left = {pid: g - allocated.get(pid, 0.0) for pid, g in gross_by_product.items()}
    left_sum = sum(left.values())

    after_offers: dict[str, float] = {}
    for it in lines:
        g = gross_by_product[it.product_id]
        share = it.line_total / g if g else 0.0
        product_discount = allocated.get(it.product_id, 0.0) + (residual * left[it.product_id] / left_sum if left_sum else 0.0)
        after_offers[it.id] = max(it.line_total - product_discount * share, 0.0)

    coupon = max(float(order.discount_amount or 0), 0.0)
    base = sum(after_offers.values())
    out = {}
    for it in lines:
        net = after_offers[it.id] - (coupon * after_offers[it.id] / base if base else 0.0)
        out[it.id] = max(net, 0.0) / it.quantity if it.quantity else 0.0
    return out


def merchandise_total(order: models.Order) -> float:
    """What the customer paid for the goods: the order total without shipping."""
    return _r(max(order.total_amount - (order.shipping_fee or 0), 0.0))


def returned_quantities(db, order_id: str) -> dict[str, int]:
    """order_item_id -> units already returned."""
    rows = (
        db.query(models.OrderReturnItem.order_item_id, func.coalesce(func.sum(models.OrderReturnItem.quantity), 0))
        .join(models.OrderReturn, models.OrderReturn.id == models.OrderReturnItem.return_id)
        .filter(models.OrderReturn.order_id == order_id)
        .group_by(models.OrderReturnItem.order_item_id)
        .all()
    )
    return {item_id: int(q) for item_id, q in rows}


def _value_of(order: models.Order, units: dict[str, float], returned: dict[str, int]) -> float:
    """Rounded value of `returned` units; everything returned = exactly the
    merchandise total (no rounding drift)."""
    if all(returned.get(it.id, 0) >= it.quantity for it in order.items):
        return merchandise_total(order)
    return _r(sum(units[item_id] * q for item_id, q in returned.items()))


def reversed_by_returns(db, order_id: str) -> float:
    return _r(float(
        db.query(func.coalesce(func.sum(models.FinanceEntry.amount), 0))
        .filter(models.FinanceEntry.reference_id == order_id)
        .filter(models.FinanceEntry.source == order_ledger.SOURCE)
        .filter(models.FinanceEntry.type == models.FinanceEntryType.expense)
        .filter(models.FinanceEntry.category == RETURN_CATEGORY)
        .scalar() or 0
    ))


# ---------------------------------------------------------------- plan / apply
class ReturnError(ValueError):
    """A return that can't be recorded as asked (message is for staff)."""


@dataclass
class PlannedLine:
    item: models.OrderItem
    quantity: int
    restock: bool
    amount: float  # display value of these units (rounded per line)


@dataclass
class ReturnPlan:
    lines: list[PlannedLine]
    merchandise_value: float   # value of the units returned now
    revenue_reversed: float    # what the ledger will reverse (0 if never recognized)
    units: int = 0
    units_restocked: int = 0
    restock: dict = field(default_factory=dict)  # product_id -> units back in stock


def plan_return(db, order: models.Order, requested: list[tuple[str, int, bool]]) -> ReturnPlan:
    """Validates and prices a return without changing anything.
    `requested`: (order_item_id, quantity, restock) per returned line."""
    if order.status != models.OrderStatus.delivered:
        raise ReturnError("المرتجع بيتسجل على طلب اتسلّم بس — الطلب اللي لسه ما اتسلّمش بيتلغي بدل كده")
    if not requested:
        raise ReturnError("اختاري قطعة واحدة على الأقل")
    by_id = {it.id: it for it in order.items}
    seen: set[str] = set()
    already = returned_quantities(db, order.id)
    lines: list[PlannedLine] = []
    for item_id, qty, restock in requested:
        it = by_id.get(item_id)
        if it is None:
            raise ReturnError("في منتج في المرتجع مش من الطلب ده")
        if item_id in seen:
            raise ReturnError(f"«{it.product_name}» متكرر في المرتجع")
        seen.add(item_id)
        if qty < 1:
            raise ReturnError(f"كمية «{it.product_name}» لازم تكون 1 أو أكتر")
        remaining = it.quantity - already.get(item_id, 0)
        if qty > remaining:
            raise ReturnError(f"«{it.product_name}»: المتاح للإرجاع {remaining} بس (اتطلب {it.quantity}، ورجع قبل كده {already.get(item_id, 0)})")
        lines.append(PlannedLine(it, qty, restock, 0.0))

    units = unit_values(db, order)
    after = dict(already)
    for l in lines:
        after[l.item.id] = after.get(l.item.id, 0) + l.quantity
        l.amount = _r(units[l.item.id] * l.quantity)
    value = _r(_value_of(order, units, after) - _value_of(order, units, already))

    reversed_now = 0.0
    if order_ledger.is_recognized(order, models):
        still_recognized = _r(order_ledger.recognized_amount(db, models, order.id) - reversed_by_returns(db, order.id))
        reversed_now = _r(max(min(value, still_recognized), 0.0))

    restock: dict[str, int] = defaultdict(int)
    for l in lines:
        if l.restock:
            restock[l.item.product_id] += l.quantity
    return ReturnPlan(lines, value, reversed_now, units=sum(l.quantity for l in lines),
                      units_restocked=sum(restock.values()), restock=dict(restock))


def apply_return(db, order: models.Order, plan: ReturnPlan, *, request_id: str, reason: str, note: str | None,
                 returned_on, processed_by: str) -> models.OrderReturn:
    """Records a planned return: the return, its lines, the restock movements
    and the revenue reversal — in the caller's transaction."""
    ret = models.OrderReturn(
        order_id=order.id, request_id=request_id, reason=reason, note=note, returned_on=returned_on,
        processed_by=processed_by, merchandise_value=plan.merchandise_value, revenue_reversed=plan.revenue_reversed,
    )
    db.add(ret)
    db.flush()
    for l in plan.lines:
        db.add(models.OrderReturnItem(
            return_id=ret.id, order_item_id=l.item.id, product_id=l.item.product_id,
            quantity=l.quantity, restock=l.restock, amount=l.amount,
        ))
    if plan.restock:
        products = (
            db.query(models.Product)
            .filter(models.Product.id.in_(sorted(plan.restock)))
            .order_by(models.Product.id)
            .with_for_update()
            .populate_existing()
            .all()
        )
        for p in products:
            services.apply_stock_movement(
                db, p, plan.restock[p.id], models.MovementType.customer_return, reference_id=order.id,
                note=f"مرتجع طلب #{order.order_number} ({ret.id}) — {processed_by}",
            )
    if plan.revenue_reversed >= _CENT:
        db.add(models.FinanceEntry(
            type=models.FinanceEntryType.expense, category=RETURN_CATEGORY, amount=plan.revenue_reversed,
            description=f"مرتجع طلب موقع #{order.order_number} ({ret.id}) — {reason} — {processed_by}",
            reference_id=order.id, source=order_ledger.SOURCE,
        ))
    return ret
