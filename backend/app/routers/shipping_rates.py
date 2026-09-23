from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/shipping-rates", tags=["Shipping Rates"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.ShippingRateOut])
def list_rates(db: Session = Depends(get_db)):
    return db.query(models.ShippingRate).order_by(models.ShippingRate.city).all()


@router.post("/", response_model=schemas.ShippingRateOut, status_code=201)
def create_rate(payload: schemas.ShippingRateCreate, db: Session = Depends(get_db)):
    city = payload.city.strip()
    if not city:
        raise HTTPException(400, "اسم المدينة مطلوب")
    if db.query(models.ShippingRate).filter(models.ShippingRate.city == city).first():
        raise HTTPException(400, "المدينة دي مضافة بالفعل")
    rate = models.ShippingRate(city=city, fee=payload.fee)
    db.add(rate)
    db.commit()
    db.refresh(rate)
    return rate


@router.patch("/{rate_id}", response_model=schemas.ShippingRateOut)
def update_rate(rate_id: str, payload: schemas.ShippingRateUpdate, db: Session = Depends(get_db)):
    rate = db.get(models.ShippingRate, rate_id)
    if not rate:
        raise HTTPException(404, "سعر الشحن غير موجود")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rate, field, value)
    db.commit()
    db.refresh(rate)
    return rate


@router.delete("/{rate_id}", status_code=204)
def delete_rate(rate_id: str, db: Session = Depends(get_db)):
    rate = db.get(models.ShippingRate, rate_id)
    if not rate:
        raise HTTPException(404, "سعر الشحن غير موجود")
    db.delete(rate)
    db.commit()
