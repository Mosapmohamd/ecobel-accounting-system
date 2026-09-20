from datetime import datetime, timezone, timedelta
from typing import List, Literal
from calendar import month_abbr

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, extract
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/reports", tags=["Reports"], dependencies=[Depends(auth.get_current_user)])

Period = Literal["today", "month", "quarter", "year"]


def period_start(period: Period, now: datetime) -> datetime:
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "quarter":
        quarter_first_month = ((now.month - 1) // 3) * 3 + 1
        return now.replace(month=quarter_first_month, day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "year":
        return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    raise HTTPException(400, "period غير صالحة — استخدم today, month, quarter, أو year")


@router.get("/dashboard", response_model=schemas.DashboardSummary)
def dashboard_summary(period: Period = "today", db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    start = period_start(period, now)

    products = db.query(models.Product).filter(models.Product.is_active == True).all()  # noqa: E712
    low_stock = sum(1 for p in products if p.stock_status == "low")
    out_of_stock = sum(1 for p in products if p.stock_status == "out")

    period_income = (
        db.query(func.coalesce(func.sum(models.FinanceEntry.amount), 0))
        .filter(models.FinanceEntry.type == models.FinanceEntryType.income)
        .filter(models.FinanceEntry.entry_date >= start)
        .scalar()
    )
    period_expense = (
        db.query(func.coalesce(func.sum(models.FinanceEntry.amount), 0))
        .filter(models.FinanceEntry.type == models.FinanceEntryType.expense)
        .filter(models.FinanceEntry.entry_date >= start)
        .scalar()
    )
    period_b2b_sales = float(
        db.query(func.coalesce(func.sum(models.B2BOrder.total_amount), 0))
        .filter(models.B2BOrder.created_at >= start)
        .scalar() or 0
    )

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
        period_income=float(period_income or 0),
        period_expense=float(period_expense or 0),
        period_b2b_sales=period_b2b_sales,
        free_distribution_events=dist_events,
        free_distribution_pieces=dist_pieces,
    )


@router.get("/monthly-sales", response_model=List[schemas.MonthlySalesPoint])
def monthly_sales(months: int = Query(6, ge=1, le=36), db: Session = Depends(get_db)):
    """Income-type finance entries grouped by month, last N months
    (this covers both website sales — recorded manually/via future website
    integration — and B2B sales, since B2B orders auto-create an income entry)."""
    now = datetime.now(timezone.utc)
    start = (now.replace(day=1) - relativedelta(months=months - 1))

    rows = (
        db.query(
            extract("year", models.FinanceEntry.entry_date).label("y"),
            extract("month", models.FinanceEntry.entry_date).label("m"),
            func.sum(models.FinanceEntry.amount).label("total"),
        )
        .filter(models.FinanceEntry.type == models.FinanceEntryType.income)
        .filter(models.FinanceEntry.entry_date >= start)
        .group_by("y", "m")
        .all()
    )
    totals_by_key = {(int(r.y), int(r.m)): float(r.total) for r in rows}

    points = []
    for i in range(months):
        d = start + relativedelta(months=i)
        key = (d.year, d.month)
        points.append(schemas.MonthlySalesPoint(
            month=month_abbr[d.month],
            total=totals_by_key.get(key, 0.0),
        ))
    return points
