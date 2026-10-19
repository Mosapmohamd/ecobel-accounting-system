from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import auth, cairo_time, models, schemas
from ..database import get_db

router = APIRouter(prefix="/offers", tags=["Offers"], dependencies=[Depends(auth.get_current_user)])


# The title is what customers see on the storefront next to the offer price.
TITLE_REQUIRED = "اكتبي عنوان للعرض — ده اللي العملاء بيشوفوه جنب السعر"


def _clean_title(title: str) -> str:
    title = title.strip()
    if not title:
        raise HTTPException(400, TITLE_REQUIRED)
    return title


def _ensure_single_active_offer(db: Session, product_id: str, exclude_offer_id: str | None = None) -> None:
    """A product has at most one running offer, so its storefront price is
    never ambiguous. Deactivate the old offer before activating a new one.
    An offer past its end date is no longer running (the storefront stopped
    showing it — see ecobel-website app/pricing.py), so it doesn't block."""
    q = (
        db.query(models.Offer)
        .filter(models.Offer.product_id == product_id)
        .filter(models.Offer.is_active == True)  # noqa: E712
        .filter(or_(models.Offer.expires_at.is_(None), models.Offer.expires_at > cairo_time.now_utc()))
    )
    if exclude_offer_id:
        q = q.filter(models.Offer.id != exclude_offer_id)
    if q.first():
        raise HTTPException(400, "المنتج ده عليه عرض شغال بالفعل — وقّفي العرض القديم الأول")


@router.get("/", response_model=List[schemas.OfferOut])
def list_offers(db: Session = Depends(get_db)):
    return db.query(models.Offer).order_by(models.Offer.created_at.desc()).all()


@router.post("/", response_model=schemas.OfferOut, status_code=201)
def create_offer(payload: schemas.OfferCreate, db: Session = Depends(get_db)):
    product = db.get(models.Product, payload.product_id)
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    if payload.offer_price >= product.sale_price:
        raise HTTPException(400, "سعر العرض لازم يكون أقل من السعر الأصلي")
    _ensure_single_active_offer(db, payload.product_id)

    title = _clean_title(payload.title)
    offer = models.Offer(
        product_id=payload.product_id,
        title=title,
        offer_price=payload.offer_price,
        expires_at=payload.expires_at,
    )
    db.add(offer)
    db.commit()
    db.refresh(offer)
    return offer


@router.patch("/{offer_id}", response_model=schemas.OfferOut)
def update_offer(offer_id: str, payload: schemas.OfferUpdate, db: Session = Depends(get_db)):
    offer = db.get(models.Offer, offer_id)
    if not offer:
        raise HTTPException(404, "العرض غير موجود")
    data = payload.model_dump(exclude_unset=True)
    if "title" in data:
        if data["title"] is None:
            raise HTTPException(400, TITLE_REQUIRED)
        data["title"] = _clean_title(data["title"])
    new_price = data.get("offer_price", offer.offer_price)
    if new_price >= offer.product.sale_price:
        raise HTTPException(400, "سعر العرض لازم يكون أقل من السعر الأصلي")
    if data.get("is_active", offer.is_active):
        _ensure_single_active_offer(db, offer.product_id, exclude_offer_id=offer.id)
    for field, value in data.items():
        setattr(offer, field, value)
    db.commit()
    db.refresh(offer)
    return offer


@router.delete("/{offer_id}", status_code=204)
def delete_offer(offer_id: str, db: Session = Depends(get_db)):
    offer = db.get(models.Offer, offer_id)
    if not offer:
        raise HTTPException(404, "العرض غير موجود")
    db.delete(offer)
    db.commit()
