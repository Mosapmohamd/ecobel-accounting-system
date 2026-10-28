"""The one revenue definition every report uses (dashboard, monthly sales,
sales analytics). See docs/REVENUE.md.

Recognized sales revenue = website orders that are COMPLETED AND PAID
(app/order_ledger.py): delivered + paid — only cash on delivery counts as
paid (collected on delivery); no other payment method has a confirmation in
this system, so none of them count. The revenue is the ledger's recognized
amount (sale income minus reversals referencing the order, shipping
included), counted only while the order is still completed and paid; dated
by the entries (when it was recognized). Entries for orders that aren't (yet)
completed and paid — e.g. older orders booked at checkout before this rule —
are not revenue.

B2B orders are NOT recognized revenue for now: they have no completion or
payment status in this system. Their booked sales (the B2B ledger: sale
income minus edit/cancellation reversals) are reported separately as
`b2b_sales` and never added to revenue or other income.
Dates are Cairo calendar days (app/cairo_time.py).

Not revenue: other income (manual income entries), cash collected (no
payment ledger exists — cash on delivery isn't tracked separately from
delivery) and Meta-attributed conversion value (not in this system).
Revenue reversals are not operating expenses.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from . import cairo_time, models, order_ledger
from .returns import RETURN_CATEGORY

B2B_SALE_CATEGORY = "مبيعات جملة B2B"
B2B_REVERSAL_CATEGORIES = ("تعديل أوردر جملة B2B", "إلغاء أوردر جملة B2B")


# ---------------------------------------------------------------- entry classes
def _source():
    # NULL (old rows) means "spending" — and keeps NOT(...) below two-valued.
    return func.coalesce(models.FinanceEntry.source, "spending")


def _website_sale_entry():
    """Entries that recognize or reverse a website order's revenue:
    sale income, cancellation reversals and return reversals."""
    return and_(
        _source() == order_ledger.SOURCE,
        models.FinanceEntry.reference_id.isnot(None),
        or_(
            and_(models.FinanceEntry.type == models.FinanceEntryType.income, models.FinanceEntry.category == order_ledger.SALE_CATEGORY),
            and_(models.FinanceEntry.type == models.FinanceEntryType.expense,
                 models.FinanceEntry.category.in_((order_ledger.REVERSAL_CATEGORY, RETURN_CATEGORY))),
        ),
    )


def _b2b_sale_entry():
    """Entries that recognize, adjust or reverse a B2B order's revenue."""
    return and_(
        _source() == "b2b",
        models.FinanceEntry.reference_id.isnot(None),
        or_(
            and_(models.FinanceEntry.type == models.FinanceEntryType.income, models.FinanceEntry.category == B2B_SALE_CATEGORY),
            and_(models.FinanceEntry.type == models.FinanceEntryType.expense, models.FinanceEntry.category.in_(B2B_REVERSAL_CATEGORIES)),
        ),
    )


def _signed(entry: models.FinanceEntry) -> float:
    return entry.amount if entry.type == models.FinanceEntryType.income else -entry.amount


def _in_range(q, start: Optional[datetime], end: Optional[datetime]):
    if start is not None:
        q = q.filter(models.FinanceEntry.entry_date >= start)
    if end is not None:
        q = q.filter(models.FinanceEntry.entry_date < end)
    return q


# ---------------------------------------------------------------- revenue
@dataclass
class RevenueLine:
    """One ledger movement (positive or negative) of an order's sale."""
    reference_id: str
    amount: float
    at: datetime
    kind: str = "sale"  # "sale" | "cancellation" | "return"


@dataclass
class Totals:
    total: float = 0.0
    lines: list = field(default_factory=list)


def _totals(lines: list[RevenueLine]) -> Totals:
    return Totals(total=round(sum(l.amount for l in lines), 2), lines=lines)


def revenue_lines(db: Session, start: Optional[datetime] = None, end: Optional[datetime] = None) -> list[RevenueLine]:
    """Every recognized revenue movement in [start, end) under the rule above."""
    q = (
        db.query(models.FinanceEntry)
        .join(models.Order, models.Order.id == models.FinanceEntry.reference_id)
        .filter(_website_sale_entry())
        .filter(models.Order.status == models.OrderStatus.delivered)
        .filter(models.Order.payment_method == order_ledger.CASH_ON_DELIVERY)
    )
    return [RevenueLine(e.reference_id, _signed(e), cairo_time.as_utc(e.entry_date), _kind(e)) for e in _in_range(q, start, end).all()]


def _kind(e: models.FinanceEntry) -> str:
    if e.type == models.FinanceEntryType.income:
        return "sale"
    return "return" if e.category == RETURN_CATEGORY else "cancellation"


def returns_total(lines: list[RevenueLine]) -> float:
    """Revenue reversed by customer returns among `lines` (a positive amount)."""
    return round(-sum(l.amount for l in lines if l.kind == "return"), 2)


def revenue(db: Session, start: Optional[datetime] = None, end: Optional[datetime] = None) -> Totals:
    """Recognized sales revenue (website, completed and paid)."""
    return _totals(revenue_lines(db, start, end))


def b2b_sales(db: Session, start: Optional[datetime] = None, end: Optional[datetime] = None) -> Totals:
    """Booked B2B sales — reported on their own, NOT recognized revenue."""
    q = db.query(models.FinanceEntry).filter(_b2b_sale_entry())
    return _totals([RevenueLine(e.reference_id, _signed(e), cairo_time.as_utc(e.entry_date)) for e in _in_range(q, start, end).all()])


def recognized_online_orders(db: Session) -> list[models.Order]:
    """Website orders that count: completed and paid."""
    return (
        db.query(models.Order)
        .filter(models.Order.status == models.OrderStatus.delivered)
        .filter(models.Order.payment_method == order_ledger.CASH_ON_DELIVERY)
        .all()
    )


# ---------------------------------------------------------------- the rest of the ledger
def other_income(db: Session, start: Optional[datetime] = None, end: Optional[datetime] = None) -> float:
    """Income entries that are not sales — website or B2B (e.g. entered manually)."""
    q = (
        db.query(models.FinanceEntry)
        .filter(models.FinanceEntry.type == models.FinanceEntryType.income)
        .filter(~_website_sale_entry())
        .filter(~_b2b_sale_entry())
    )
    return round(sum(e.amount for e in _in_range(q, start, end).all()), 2)


def operating_expenses(db: Session, start: Optional[datetime] = None, end: Optional[datetime] = None) -> float:
    """Expense entries that are real spending — revenue reversals excluded."""
    q = (
        db.query(models.FinanceEntry)
        .filter(models.FinanceEntry.type == models.FinanceEntryType.expense)
        .filter(~_website_sale_entry())
        .filter(~_b2b_sale_entry())
    )
    return round(sum(e.amount for e in _in_range(q, start, end).all()), 2)


# ---------------------------------------------------------------- Cairo calendar
def cairo_day_start(day: date) -> datetime:
    """The instant a Cairo calendar day starts (UTC)."""
    return cairo_time.end_of_cairo_day(day - timedelta(days=1))


def cairo_date(at: datetime) -> date:
    return cairo_time.as_utc(at).astimezone(cairo_time.CAIRO).date()


def period_start(period: str, now: Optional[datetime] = None) -> datetime:
    """Start of today / this month / quarter / year, in Cairo."""
    today = cairo_time.cairo_today(now)
    if period == "today":
        day = today
    elif period == "month":
        day = today.replace(day=1)
    elif period == "quarter":
        day = today.replace(month=((today.month - 1) // 3) * 3 + 1, day=1)
    elif period == "year":
        day = today.replace(month=1, day=1)
    else:
        raise ValueError(period)
    return cairo_day_start(day)


def by_cairo_day(lines: list[RevenueLine]) -> dict[date, float]:
    out: dict[date, float] = defaultdict(float)
    for l in lines:
        out[cairo_date(l.at)] += l.amount
    return out
