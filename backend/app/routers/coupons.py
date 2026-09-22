from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/coupons", tags=["Coupons"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.CouponOut])
def list_coupons(db: Session = Depends(get_db)):
    return db.query(models.Coupon).order_by(models.Coupon.created_at.desc()).all()


@router.post("/", response_model=schemas.CouponOut, status_code=201)
def create_coupon(payload: schemas.CouponCreate, db: Session = Depends(get_db)):
    code = payload.code.strip().upper()
    if not code:
        raise HTTPException(400, "كود الكوبون مطلوب")
    if db.query(models.Coupon).filter(models.Coupon.code == code).first():
        raise HTTPException(400, "الكود ده مستخدم بالفعل")
    if payload.discount_type == models.CouponDiscountType.percentage and payload.discount_value > 100:
        raise HTTPException(400, "نسبة الخصم لازم تكون 100% أو أقل")

    if payload.limit_type == schemas.CouponLimitType.duration and not payload.expires_at:
        raise HTTPException(400, "لازم تحدد تاريخ انتهاء لكوبون محدود بمدة")
    if payload.limit_type == schemas.CouponLimitType.count and not payload.max_uses:
        raise HTTPException(400, "لازم تحدد عدد مرات الاستخدام لكوبون محدود بعدد")

    max_uses = payload.max_uses if payload.limit_type == schemas.CouponLimitType.count else None
    expires_at = payload.expires_at if payload.limit_type == schemas.CouponLimitType.duration else None

    coupon = models.Coupon(
        code=code,
        discount_type=payload.discount_type,
        discount_value=payload.discount_value,
        min_order_amount=payload.min_order_amount,
        max_uses=max_uses,
        expires_at=expires_at,
    )
    db.add(coupon)
    db.commit()
    db.refresh(coupon)
    return coupon


@router.patch("/{coupon_id}", response_model=schemas.CouponOut)
def update_coupon(coupon_id: str, payload: schemas.CouponUpdate, db: Session = Depends(get_db)):
    coupon = db.get(models.Coupon, coupon_id)
    if not coupon:
        raise HTTPException(404, "الكوبون غير موجود")

    data = payload.model_dump(exclude_unset=True)
    limit_type = data.pop("limit_type", None)
    if limit_type == schemas.CouponLimitType.count:
        coupon.expires_at = None
        if "max_uses" not in data:
            raise HTTPException(400, "لازم تحدد عدد مرات الاستخدام")
    elif limit_type == schemas.CouponLimitType.duration:
        coupon.max_uses = None
        if "expires_at" not in data:
            raise HTTPException(400, "لازم تحدد تاريخ انتهاء")
    elif limit_type == schemas.CouponLimitType.unlimited:
        coupon.max_uses = None
        coupon.expires_at = None

    for field, value in data.items():
        setattr(coupon, field, value)

    db.commit()
    db.refresh(coupon)
    return coupon


@router.post("/{coupon_id}/renew", response_model=schemas.CouponOut)
def renew_coupon(coupon_id: str, db: Session = Depends(get_db)):
    coupon = db.get(models.Coupon, coupon_id)
    if not coupon:
        raise HTTPException(404, "الكوبون غير موجود")
    coupon.used_count = 0
    coupon.is_active = True
    db.commit()
    db.refresh(coupon)
    return coupon


@router.delete("/{coupon_id}", status_code=204)
def delete_coupon(coupon_id: str, db: Session = Depends(get_db)):
    coupon = db.get(models.Coupon, coupon_id)
    if not coupon:
        raise HTTPException(404, "الكوبون غير موجود")
    db.delete(coupon)
    db.commit()
