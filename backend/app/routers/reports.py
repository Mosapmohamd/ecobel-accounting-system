from datetime import datetime, timezone
from typing import List, Literal
from calendar import month_abbr

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, revenue, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/reports", tags=["Reports"], dependencies=[Depends(auth.get_current_user)])

Period = Literal["today", "month", "quarter", "year"]


@router.get("/dashboard", response_model=schemas.DashboardSummary)
def dashboard_summary(period: Period = "today", db: Session = Depends(get_db)):
    """Period figures from the one revenue definition (app/revenue.py):
    sales revenue = completed AND paid website orders (B2B sales are shown
    on their own, not as revenue); other income and operating
    expenses are the rest of the ledger (revenue reversals aren't expenses).
    Periods are Cairo calendar periods."""
    start = revenue.period_start(period)

    products = db.query(models.Product).filter(models.Product.is_active == True).all()  # noqa: E712
    low_stock = sum(1 for p in products if p.stock_status == "low")
    out_of_stock = sum(1 for p in products if p.stock_status == "out")

    sales = revenue.revenue(db, start)
    other = revenue.other_income(db, start)

    dist_row = (
        db.query(
            func.count(func.distinct(models.FreeDistribution.id)),
            func.coalesce(func.sum(models.FreeDistributionItem.quantity), 0),
        )
        .join(models.FreeDistributionItem, models.FreeDistributionItem.distribution_id == models.FreeDistribution.id)
        .filter(models.FreeDistribution.created_at >= start)
        .first()
    )
    dist_events, dist_pieces = int(dist_row[0] or 0), int(dist_row[1] or 0)

    return schemas.DashboardSummary(
        period=period,
        total_products=len(products),
        low_stock_count=low_stock,
        out_of_stock_count=out_of_stock,
        period_revenue=sales.total,
        period_returns=revenue.returns_total(sales.lines),
        period_online_revenue=sales.total,
        period_b2b_sales=revenue.b2b_sales(db, start).total,
        period_other_income=other,
        period_income=round(sales.total + other, 2),
        period_expense=revenue.operating_expenses(db, start),
        free_distribution_events=dist_events,
        free_distribution_pieces=dist_pieces,
    )


@router.get("/monthly-sales", response_model=List[schemas.MonthlySalesPoint])
def monthly_sales(months: int = Query(6, ge=1, le=36), db: Session = Depends(get_db)):
    """Sales revenue (app/revenue.py — completed and paid orders, online and
    B2B) per Cairo calendar month, last N months."""
    today = revenue.cairo_date(datetime.now(timezone.utc))
    first = today.replace(day=1) - relativedelta(months=months - 1)
    lines = revenue.revenue_lines(db, revenue.cairo_day_start(first))
    totals: dict[tuple[int, int], float] = {}
    for line in lines:
        d = revenue.cairo_date(line.at)
        totals[(d.year, d.month)] = totals.get((d.year, d.month), 0.0) + line.amount
    points = []
    for i in range(months):
        d = first + relativedelta(months=i)
        points.append(schemas.MonthlySalesPoint(month=month_abbr[d.month], total=round(totals.get((d.year, d.month), 0.0), 2)))
    return points
