from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import auth, models, revenue, schemas
from ..database import get_db

router = APIRouter(prefix="/sales-analytics", tags=["Sales Analytics"], dependencies=[Depends(auth.get_current_user)])

Source = Literal["all", "online", "b2b"]


@router.get("/", response_model=schemas.SalesAnalytics)
def sales_analytics(source: Source = Query("all"), db: Session = Depends(get_db)):
    """Sales analytics on the one revenue definition (app/revenue.py):
    revenue, order count, the daily series and top products count only
    completed AND paid website orders; days are Cairo days, dated when the
    revenue was recognized. B2B orders aren't recognized revenue yet — their
    booked sales come back on their own (`b2b_sales`), and with source=b2b
    the top products are B2B volumes. `orders_by_status` counts every order
    (it's the pipeline, not revenue)."""
    now = datetime.now(timezone.utc)
    first_day = revenue.cairo_date(now) - timedelta(days=30)

    online = source in ("all", "online")
    sales = revenue.revenue(db) if online else revenue.Totals()
    daily = revenue.by_cairo_day([l for l in sales.lines if revenue.cairo_date(l.at) >= first_day])
    status_counts: dict[str, int] = defaultdict(int)
    item_stats: dict[str, dict] = defaultdict(lambda: {"quantity": 0, "revenue": 0.0})
    total_orders = 0
    b2b_sales = 0.0
    partial = full = 0

    if online:
        for (status,) in db.query(models.Order.status).all():
            status_counts[status.value] += 1
        recognized = revenue.recognized_online_orders(db)
        total_orders = len(recognized)
        # Partly / fully returned orders, from the return reversals in the ledger.
        reversed_by: dict[str, float] = defaultdict(float)
        for l in sales.lines:
            if l.kind == "return":
                reversed_by[l.reference_id] -= l.amount
        for o in recognized:
            if reversed_by.get(o.id, 0) > 0:
                if reversed_by[o.id] >= round(o.total_amount - (o.shipping_fee or 0), 2) - 0.005:
                    full += 1
                else:
                    partial += 1
        ids = [o.id for o in recognized]
        if ids:
            for it in db.query(models.OrderItem).filter(models.OrderItem.order_id.in_(ids)).all():
                item_stats[it.product_name]["quantity"] += it.quantity
                item_stats[it.product_name]["revenue"] += it.line_total

    if source in ("all", "b2b"):
        b2b_sales = revenue.b2b_sales(db).total
        status_counts["b2b"] = db.query(models.B2BOrder).count()
    if source == "b2b":
        names = dict(db.query(models.Product.id, models.Product.name).all())
        for it in db.query(models.B2BOrderItem).all():
            name = names.get(it.product_id, it.product_id)
            item_stats[name]["quantity"] += it.quantity
            item_stats[name]["revenue"] += it.line_total

    revenue_points = [
        schemas.RevenuePoint(date=(first_day + timedelta(days=i)).isoformat(),
                             total=round(daily.get(first_day + timedelta(days=i), 0.0), 2))
        for i in range(31)
    ]
    top_products = sorted(
        (schemas.TopProduct(product_name=n, quantity_sold=s["quantity"], revenue=s["revenue"]) for n, s in item_stats.items()),
        key=lambda p: p.quantity_sold,
        reverse=True,
    )[:5]

    return schemas.SalesAnalytics(
        source=source,
        total_revenue=sales.total,
        total_orders=total_orders,
        b2b_sales=b2b_sales,
        returns_total=revenue.returns_total(sales.lines),
        partially_returned_orders=partial,
        fully_returned_orders=full,
        orders_by_status=dict(status_counts),
        revenue_last_30_days=revenue_points,
        top_products=top_products,
    )
