from datetime import datetime, timezone
from typing import List
from calendar import month_abbr

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func, extract
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/reports", tags=["Reports"], dependencies=[Depends(auth.get_current_user)])


@router.get("/dashboard", response_model=schemas.DashboardSummary)
def dashboard_summary(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    products = db.query(models.Product).filter(models.Product.is_active == True).all()  # noqa: E712
    low_stock = sum(1 for p in products if p.stock_status == "low")
    out_of_stock = sum(1 for p in products if p.stock_status == "out")

    month_income = (
        db.query(func.coalesce(func.sum(models.FinanceEntry.amount), 0))
        .filter(models.FinanceEntry.type == models.FinanceEntryType.income)
        .filter(models.FinanceEntry.entry_date >= month_start)
        .scalar()
    )
    month_expense = (
        db.query(func.coalesce(func.sum(models.FinanceEntry.amount), 0))
        .filter(models.FinanceEntry.type == models.FinanceEntryType.expense)
        .filter(models.FinanceEntry.entry_date >= month_start)
        .scalar()
    )
    month_b2b_sales = (
        db.query(func.coalesce(func.sum(models.B2BOrder.total_amount), 0))
        .filter(models.B2BOrder.created_at >= month_start)
        .scalar()
    )

    return schemas.DashboardSummary(
        total_products=len(products),
        low_stock_count=low_stock,
        out_of_stock_count=out_of_stock,
        month_income=float(month_income or 0),
        month_expense=float(month_expense or 0),
        month_b2b_sales=float(month_b2b_sales or 0),
    )


@router.get("/monthly-sales", response_model=List[schemas.MonthlySalesPoint])
def monthly_sales(months: int = 6, db: Session = Depends(get_db)):
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
