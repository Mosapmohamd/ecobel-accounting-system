from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/sales-analytics", tags=["Sales Analytics"], dependencies=[Depends(auth.get_current_user)])

Source = Literal["all", "online", "b2b"]


def _naive(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


@router.get("/", response_model=schemas.SalesAnalytics)
def sales_analytics(source: Source = Query("all"), db: Session = Depends(get_db)):
    """Combined sales analytics across online (b2c) and B2B orders.
    `source` filters to one channel or shows both together. The two order
    types live in separate tables (orders vs b2b_orders) — this endpoint
    unifies them only in the response, keeping each table clean."""
    now = datetime.now(timezone.utc)
    since = _naive(now - timedelta(days=30))

    total_revenue = 0.0
    total_orders = 0
    status_counts: dict[str, int] = defaultdict(int)
    daily = defaultdict(float)
    item_stats: dict[str, dict] = defaultdict(lambda: {"quantity": 0, "revenue": 0.0})

    # ---- Online (b2c) orders ----
    if source in ("all", "online"):
        online = db.query(models.Order).all()
        for o in online:
            if o.status != models.OrderStatus.cancelled:
                total_revenue += o.total_amount
                total_orders += 1
                created = _naive(o.created_at)
                if created and created >= since:
                    daily[created.strftime("%Y-%m-%d")] += o.total_amount
            status_counts[o.status.value] += 1
        online_items = (
            db.query(models.OrderItem)
            .join(models.Order, models.Order.id == models.OrderItem.order_id)
            .filter(models.Order.status != models.OrderStatus.cancelled)
            .all()
        )
        for it in online_items:
            item_stats[it.product_name]["quantity"] += it.quantity
            item_stats[it.product_name]["revenue"] += it.line_total

    # ---- B2B orders ----
    if source in ("all", "b2b"):
        b2b = db.query(models.B2BOrder).all()
        for o in b2b:
            total_revenue += o.total_amount
            total_orders += 1
            created = _naive(o.created_at)
            if created and created >= since:
                daily[created.strftime("%Y-%m-%d")] += o.total_amount
            status_counts["b2b"] += 1  # B2B orders have no lifecycle status
        b2b_items = db.query(models.B2BOrderItem).join(
            models.B2BOrder, models.B2BOrder.id == models.B2BOrderItem.order_id
        ).all()
        for it in b2b_items:
            product = db.get(models.Product, it.product_id)
            name = product.name if product else it.product_id
            item_stats[name]["quantity"] += it.quantity
            item_stats[name]["revenue"] += it.line_total

    revenue_points = [
        schemas.RevenuePoint(
            date=(since + timedelta(days=i)).strftime("%Y-%m-%d"),
            total=daily.get((since + timedelta(days=i)).strftime("%Y-%m-%d"), 0.0),
        )
        for i in range(31)
    ]
    top_products = sorted(
        (schemas.TopProduct(product_name=n, quantity_sold=s["quantity"], revenue=s["revenue"]) for n, s in item_stats.items()),
        key=lambda p: p.quantity_sold,
        reverse=True,
    )[:5]

    return schemas.SalesAnalytics(
        source=source,
        total_revenue=total_revenue,
        total_orders=total_orders,
        orders_by_status=dict(status_counts),
        revenue_last_30_days=revenue_points,
        top_products=top_products,
    )
