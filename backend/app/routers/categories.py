from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/categories", tags=["Categories"], dependencies=[Depends(auth.get_current_user)])


def _same_name(db: Session, name: str):
    """Categories whose name equals `name` ignoring case and spacing."""
    return db.query(models.Category).filter(func.lower(func.trim(models.Category.name)) == name.lower())


def _counts(db: Session, category_ids=None) -> dict[str, tuple[int, int]]:
    """category id → (active products, archived products)."""
    q = db.query(models.Product.category_id, models.Product.is_active, func.count(models.Product.id))
    if category_ids is not None:
        q = q.filter(models.Product.category_id.in_(category_ids))
    out: dict[str, list[int]] = {}
    for cid, active, n in q.group_by(models.Product.category_id, models.Product.is_active):
        out.setdefault(cid, [0, 0])[0 if active else 1] += n
    return {k: (v[0], v[1]) for k, v in out.items()}


def _out(category: models.Category, counts: dict) -> schemas.CategoryOut:
    active, archived = counts.get(category.id, (0, 0))
    return schemas.CategoryOut(
        id=category.id, name=category.name, created_at=category.created_at,
        product_count=active, archived_product_count=archived,
    )


def _category_or_404(db: Session, category_id: str, lock: bool = False) -> models.Category:
    q = db.query(models.Category).filter(models.Category.id == category_id)
    if lock:
        q = q.with_for_update()
    category = q.one_or_none()
    if not category:
        raise HTTPException(404, "الفئة غير موجودة")
    return category


@router.get("/", response_model=List[schemas.CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    """Every category, by name, with its product counts. `product_count` is
    the active products — the number the storefront shows on the category."""
    counts = _counts(db)
    return [_out(c, counts) for c in db.query(models.Category).order_by(models.Category.name).all()]


@router.get("/{category_id}", response_model=schemas.CategoryOut)
def get_category(category_id: str, db: Session = Depends(get_db)):
    category = _category_or_404(db, category_id)
    return _out(category, _counts(db, [category.id]))


@router.post("/", response_model=schemas.CategoryOut, status_code=201)
def create_category(payload: schemas.CategoryCreate, db: Session = Depends(get_db)):
    """Idempotent: adding a name that already exists (ignoring case and
    spacing) returns that category instead of creating a twin — the product
    form relies on this."""
    existing = _same_name(db, payload.name).first()
    if existing:
        return _out(existing, _counts(db, [existing.id]))
    category = models.Category(name=payload.name)
    db.add(category)
    try:
        db.commit()
    except IntegrityError:  # the same name added at the same moment
        db.rollback()
        existing = _same_name(db, payload.name).first()
        if existing is None:
            raise
        return _out(existing, _counts(db, [existing.id]))
    db.refresh(category)
    return _out(category, {})


@router.patch("/{category_id}", response_model=schemas.CategoryOut)
def rename_category(category_id: str, payload: schemas.CategoryUpdate, db: Session = Depends(get_db)):
    """Rename. Products refer to the category by id, so they all stay in it;
    the storefront shows the new name from its next request."""
    category = _category_or_404(db, category_id, lock=True)
    clash = _same_name(db, payload.name).filter(models.Category.id != category.id).first()
    if clash:
        raise HTTPException(409, f"فيه فئة تانية اسمها «{clash.name}» — اختاري اسم مختلف")
    category.name = payload.name
    try:
        db.commit()
    except IntegrityError:  # another rename/create took the name at the same moment
        db.rollback()
        raise HTTPException(409, "فيه فئة تانية بنفس الاسم — اختاري اسم مختلف")
    db.refresh(category)
    return _out(category, _counts(db, [category.id]))


@router.delete("/{category_id}", status_code=204)
def delete_category(category_id: str, db: Session = Depends(get_db)):
    """Only an unused category can be deleted: nothing is ever cascaded.
    Products (archived ones too — order and stock history point at them) and
    offers that target the category keep it."""
    category = _category_or_404(db, category_id, lock=True)
    active, archived = _counts(db, [category.id]).get(category.id, (0, 0))
    offers = db.query(models.PromotionTarget).filter(models.PromotionTarget.category_id == category.id).count()
    if active or archived or offers:
        reasons = []
        if active:
            reasons.append(f"{active} منتج ظاهر")
        if archived:
            reasons.append(f"{archived} منتج مؤرشف")
        if offers:
            reasons.append(f"{offers} عرض مرتبط بيها")
        raise HTTPException(
            409,
            f"مينفعش تمسحي فئة «{category.name}» — عليها {' و'.join(reasons)}. "
            "انقلي المنتجات لفئة تانية وشيلي الفئة من العروض الأول، أو سيبيها زي ما هي.",
        )
    db.delete(category)
    try:
        db.commit()
    except IntegrityError:  # a product was added to it at the same moment
        db.rollback()
        raise HTTPException(409, f"مينفعش تمسحي فئة «{category.name}» — اتضاف عليها منتج دلوقتي")
