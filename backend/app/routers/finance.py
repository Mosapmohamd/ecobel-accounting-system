from datetime import datetime
from typing import List, Optional, Literal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth, revenue
from ..database import get_db

router = APIRouter(prefix="/finance", tags=["Finance"], dependencies=[Depends(auth.get_current_user)])


@router.get("/entries", response_model=List[schemas.FinanceEntryOut])
def list_entries(
    type: Optional[models.FinanceEntryType] = None,
    source: Optional[Literal["website", "b2b", "spending"]] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.FinanceEntry)
    if type:
        q = q.filter(models.FinanceEntry.type == type)
    if source:
        if source == "spending":
            # Old rows predate the `source` column and were always manual
            # (expense/other) entries — treat NULL the same as "spending".
            q = q.filter((models.FinanceEntry.source == "spending") | (models.FinanceEntry.source.is_(None)))
        else:
            q = q.filter(models.FinanceEntry.source == source)
    if date_from:
        q = q.filter(models.FinanceEntry.entry_date >= date_from)
    if date_to:
        q = q.filter(models.FinanceEntry.entry_date <= date_to)
    return q.order_by(models.FinanceEntry.entry_date.desc()).all()


@router.post("/entries", response_model=schemas.FinanceEntryOut, status_code=201)
def create_entry(payload: schemas.FinanceEntryCreate, db: Session = Depends(get_db)):
    """Manual entries — expenses (raw materials, shipping, etc.) and income
    not recorded automatically, under any section. The categories the
    automatic order entries use are reserved, so a manual entry can never be
    mistaken for (or counted as) an order's sale or reversal."""
    if payload.category in revenue.AUTOMATIC_CATEGORIES:
        raise HTTPException(
            400,
            f"الفئة «{payload.category}» بيستخدمها السيستم للقيود التلقائية بتاعة الطلبات — "
            "مبيعات الطلبات بتتسجل لوحدها. اختاري اسم فئة تاني للقيد اليدوي.",
        )
    # exclude_unset keeps the model's own default date; the source is always
    # stored (an unset source used to be saved as NULL).
    data = payload.model_dump(exclude_unset=True)
    data["source"] = payload.source
    entry = models.FinanceEntry(**data)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry
