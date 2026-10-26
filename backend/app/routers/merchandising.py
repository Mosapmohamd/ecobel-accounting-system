"""Homepage merchandising — which products and routines the storefront's
homepage features, and in what order. Staff manage it here; the website
reads the same tables (GET /catalog/featured-products, /featured-routines).

Each save replaces the whole selection for one section in a single
transaction, so the homepage never shows a half-applied reorder.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/merchandising", tags=["Merchandising"], dependencies=[Depends(auth.get_current_user)])


def _product_issue(p: models.Product) -> str | None:
    if not p.is_active:
        return "المنتج متوقف"
    if p.quantity <= 0:
        return "المنتج نفد من المخزون"
    return None


OUT_OF_STOCK_NOTE = "نفد من المخزون — بيظهر في الموقع كـ «نفد من المخزون» ومش متاح للشراء"


def _featured_slot(r: models.FeaturedProduct) -> schemas.FeaturedProductSlot:
    """A featured product shows on the homepage while it's active — out of
    stock included (as «نفد من المخزون», not purchasable)."""
    p = r.product
    issue = "المنتج متوقف" if not p.is_active else (OUT_OF_STOCK_NOTE if p.quantity <= 0 else None)
    return schemas.FeaturedProductSlot(position=r.position, product=p, is_visible=bool(p.is_active), issue=issue)


def _routine_issue(r: models.Routine) -> str | None:
    if not r.is_active:
        return "الروتين متوقف"
    if not r.items:
        return "الروتين مفيهوش منتجات"
    for it in r.items:
        issue = _product_issue(it.product)
        if issue:
            return f"{it.product.name}: {issue}"
    return None


def _routine_query(db: Session):
    return db.query(models.Routine).options(joinedload(models.Routine.items).joinedload(models.RoutineItem.product))


def _no_duplicates(ids: List[str]) -> None:
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "نفس العنصر متكرر في القائمة — كل عنصر يظهر مرة واحدة بس")


# ---------------- Featured products ----------------
@router.get("/featured-products", response_model=List[schemas.FeaturedProductSlot])
def get_featured_products(db: Session = Depends(get_db)):
    rows = (
        db.query(models.FeaturedProduct)
        .options(joinedload(models.FeaturedProduct.product).joinedload(models.Product.category))
        .order_by(models.FeaturedProduct.position)
        .all()
    )
    return [_featured_slot(r) for r in rows]


@router.put("/featured-products", response_model=List[schemas.FeaturedProductSlot])
def set_featured_products(payload: schemas.FeaturedProductsUpdate, db: Session = Depends(get_db)):
    ids = payload.product_ids
    if len(ids) > models.FEATURED_PRODUCTS_MAX:
        raise HTTPException(400, f"أقصى عدد للمنتجات المختارة {models.FEATURED_PRODUCTS_MAX}")
    _no_duplicates(ids)
    products = {p.id: p for p in db.query(models.Product).filter(models.Product.id.in_(ids)).all()} if ids else {}
    for pid in ids:
        p = products.get(pid)
        if p is None:
            raise HTTPException(404, "في منتج في القائمة مش موجود")
        if not p.is_active:
            raise HTTPException(400, f"{p.name}: المنتج متوقف — مينفعش يظهر في الصفحة الرئيسية")

    db.query(models.FeaturedProduct).delete()
    db.flush()
    for position, pid in enumerate(ids, start=1):
        db.add(models.FeaturedProduct(position=position, product_id=pid))
    db.commit()
    return get_featured_products(db)


# ---------------- Featured routines ----------------
@router.get("/featured-routines", response_model=List[schemas.FeaturedRoutineSlot])
def get_featured_routines(db: Session = Depends(get_db)):
    rows = (
        db.query(models.FeaturedRoutine)
        .options(joinedload(models.FeaturedRoutine.routine).joinedload(models.Routine.items).joinedload(models.RoutineItem.product))
        .order_by(models.FeaturedRoutine.position)
        .all()
    )
    return [
        schemas.FeaturedRoutineSlot(position=r.position, routine=r.routine, is_visible=_routine_issue(r.routine) is None, issue=_routine_issue(r.routine))
        for r in rows
    ]


@router.put("/featured-routines", response_model=List[schemas.FeaturedRoutineSlot])
def set_featured_routines(payload: schemas.FeaturedRoutinesUpdate, db: Session = Depends(get_db)):
    ids = payload.routine_ids
    if len(ids) > models.FEATURED_ROUTINES_MAX:
        raise HTTPException(400, f"أقصى عدد للروتينات المختارة {models.FEATURED_ROUTINES_MAX}")
    _no_duplicates(ids)
    routines = {r.id: r for r in _routine_query(db).filter(models.Routine.id.in_(ids)).all()} if ids else {}
    for rid in ids:
        r = routines.get(rid)
        if r is None:
            raise HTTPException(404, "في روتين في القائمة مش موجود")
        issue = _routine_issue(r)
        if issue:
            raise HTTPException(400, f"{r.name}: {issue} — مينفعش يظهر في الصفحة الرئيسية")

    db.query(models.FeaturedRoutine).delete()
    db.flush()
    for position, rid in enumerate(ids, start=1):
        db.add(models.FeaturedRoutine(position=position, routine_id=rid))
    db.commit()
    return get_featured_routines(db)


# ---------------- the announcement bar (storefront_settings) ----------------
ANNOUNCEMENT_KEY = "announcement_bar"


def announcement_settings(db: Session) -> schemas.AnnouncementBar:
    """Saved settings — or the defaults (today's bar) when none were saved."""
    row = db.get(models.StorefrontSetting, ANNOUNCEMENT_KEY)
    return schemas.AnnouncementBar.model_validate(row.value) if row and row.value else schemas.AnnouncementBar()


@router.get("/announcement-bar", response_model=schemas.AnnouncementBar)
def get_announcement_bar(db: Session = Depends(get_db)):
    return announcement_settings(db)


@router.put("/announcement-bar", response_model=schemas.AnnouncementBar)
def set_announcement_bar(
    payload: schemas.AnnouncementBar,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    """Saves the bar; the storefront shows it within a minute, no rebuild."""
    if payload.enabled and not payload.has_text:
        raise HTTPException(400, "اكتبي نص الإعلان قبل ما تفعّلي الشريط")
    row = db.get(models.StorefrontSetting, ANNOUNCEMENT_KEY)
    if row is None:
        row = models.StorefrontSetting(key=ANNOUNCEMENT_KEY)
        db.add(row)
    row.value = payload.model_dump()
    row.updated_by = user.username
    db.commit()
    return announcement_settings(db)
