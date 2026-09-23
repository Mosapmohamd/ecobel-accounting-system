from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/offers", tags=["Offers"], dependencies=[Depends(auth.get_current_user)])


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

    offer = models.Offer(
        product_id=payload.product_id,
        title=payload.title,
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
    new_price = data.get("offer_price", offer.offer_price)
    if new_price >= offer.product.sale_price:
        raise HTTPException(400, "سعر العرض لازم يكون أقل من السعر الأصلي")
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
