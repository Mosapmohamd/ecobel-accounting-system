from datetime import date, datetime
from io import BytesIO
from typing import Optional, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session, joinedload

from .. import auth, cairo_time, models
from ..database import get_db

router = APIRouter(prefix="/reports/export", tags=["Reports"], dependencies=[Depends(auth.get_current_user)])

FINANCE_TYPE_LABEL = {"income": "إيراد", "expense": "مصروف"}
SOURCE_LABEL = {"website": "الموقع", "b2b": "جملة B2B", "spending": "مصروفات عامة", None: "مصروفات عامة"}
STATUS_LABEL = {"pending": "قيد التجهيز", "shipped": "في الطريق", "delivered": "تم التوصيل", "cancelled": "ملغي"}


_FORMULA_PREFIXES = ("=", "+", "-", "@")

# Every Excel download is named <report>[_<filter>]_<YYYY-MM-DD>.xlsx — ASCII
# letters, digits, "_" and "-" only, so it's a safe filename on every OS and
# needs no special header encoding. The date is today's date in Cairo, on any
# server clock. The admin UI (frontend/src/lib/exportFilename.ts) names its
# downloads the same way, also with the Cairo date.
FILTER_SLUG = {"website": "Website", "b2b": "B2B", "spending": "Spending", "income": "Income", "expense": "Expense",
               "pending": "Pending", "shipped": "Shipped", "delivered": "Delivered", "cancelled": "Cancelled"}


def export_filename(report: str, *filters: str | None, today: date | None = None) -> str:
    """e.g. export_filename("Finance_Report", "website") ->
    Finance_Report_Website_2026-10-10.xlsx"""
    parts = [report, *(FILTER_SLUG[f] for f in filters if f)]
    return f"{'_'.join(parts)}_{(today or cairo_time.cairo_today()).isoformat()}.xlsx"


def _safe_cell(value):
    """Defuse Excel/CSV formula injection (CWE-1236): a customer-supplied
    string (name, address, note, ...) that starts with =, +, -, or @ would
    otherwise be interpreted as a formula the moment staff open the file
    in Excel. Numbers and non-strings pass through untouched."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def _safe_row(row):
    return [_safe_cell(v) for v in row]


def _xlsx_response(wb: Workbook, filename: str) -> StreamingResponse:
    for ws in wb.worksheets:
        for col_cells in ws.columns:
            length = max((len(str(c.value)) if c.value is not None else 0) for c in col_cells)
            ws.column_dimensions[get_column_letter(col_cells[0].column)].width = min(max(length + 2, 10), 50)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/finance")
def export_finance(
    source: Optional[Literal["website", "b2b", "spending"]] = None,
    type: Optional[models.FinanceEntryType] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.FinanceEntry)
    if type:
        q = q.filter(models.FinanceEntry.type == type)
    if source:
        if source == "spending":
            q = q.filter((models.FinanceEntry.source == "spending") | (models.FinanceEntry.source.is_(None)))
        else:
            q = q.filter(models.FinanceEntry.source == source)
    if date_from:
        q = q.filter(models.FinanceEntry.entry_date >= date_from)
    if date_to:
        q = q.filter(models.FinanceEntry.entry_date <= date_to)
    entries = q.order_by(models.FinanceEntry.entry_date.desc()).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "الحركات المالية"
    ws.append(["النوع", "المصدر", "الفئة", "المبلغ", "الوصف", "التاريخ"])
    for e in entries:
        ws.append(_safe_row([
            FINANCE_TYPE_LABEL.get(e.type.value, e.type.value),
            SOURCE_LABEL.get(e.source, e.source or "مصروفات عامة"),
            e.category,
            e.amount,
            e.description or "",
            e.entry_date.strftime("%Y-%m-%d %H:%M") if e.entry_date else "",
        ]))
    return _xlsx_response(wb, export_filename("Finance_Report", source, type.value if type else None))


@router.get("/online-orders")
def export_online_orders(
    status: Optional[models.OrderStatus] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.Order).options(joinedload(models.Order.items))
    if status:
        q = q.filter(models.Order.status == status)
    orders = q.order_by(models.Order.created_at.desc()).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "طلبات الموقع"
    ws.append([
        "رقم الطلب", "اسم العميل", "التليفون", "المدينة", "العنوان", "الحالة",
        "المنتجات", "الإجمالي الفرعي", "الخصم", "الشحن", "الإجمالي", "التاريخ",
    ])
    for o in orders:
        items_str = " | ".join(f"{it.product_name} × {it.quantity}" for it in o.items)
        ws.append(_safe_row([
            o.order_number, o.customer_name, o.customer_phone, o.city or "", o.shipping_address,
            STATUS_LABEL.get(o.status.value, o.status.value), items_str,
            o.subtotal, o.discount_amount, o.shipping_fee, o.total_amount,
            o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
        ]))
    return _xlsx_response(wb, export_filename("Online_Orders_Report", status.value if status else None))


@router.get("/b2b-orders")
def export_b2b_orders(db: Session = Depends(get_db)):
    orders = (
        db.query(models.B2BOrder)
        .options(joinedload(models.B2BOrder.items), joinedload(models.B2BOrder.customer))
        .order_by(models.B2BOrder.created_at.desc())
        .all()
    )

    wb = Workbook()
    ws = wb.active
    ws.title = "أوردرات B2B"
    ws.append(["العميل", "المنتجات والكميات", "خصم إضافي لمرة واحدة", "الإجمالي بعد الخصم", "ملاحظات", "التاريخ"])
    for o in orders:
        items_str = " | ".join(f"{it.product_id} × {it.quantity}" for it in o.items)
        ws.append(_safe_row([
            o.customer.name if o.customer else "—",
            items_str,
            f"{o.extra_discount_percentage}%" if o.extra_discount_percentage else "—",
            o.total_amount,
            o.note or "",
            o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
        ]))
    return _xlsx_response(wb, export_filename("B2B_Orders_Report"))


@router.get("/inventory")
def export_inventory(db: Session = Depends(get_db)):
    products = db.query(models.Product).order_by(models.Product.name).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "المخزون"
    ws.append(["المنتج", "الفئة", "SKU", "سعر البيع", "الكمية", "حد إعادة الطلب", "الحالة", "نشط"])
    for p in products:
        status_ar = {"ok": "متوفر", "low": "منخفض", "out": "نفذ"}[p.stock_status]
        ws.append(_safe_row([
            p.name, p.category.name if p.category else "", p.sku or "",
            p.sale_price, p.quantity, p.low_stock_threshold, status_ar,
            "نعم" if p.is_active else "لا",
        ]))
    return _xlsx_response(wb, export_filename("Inventory_Report"))
