from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/reviews", tags=["Reviews"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.ReviewAdminOut])
def list_reviews(is_approved: Optional[bool] = None, db: Session = Depends(get_db)):
    q = db.query(models.Review).options(joinedload(models.Review.product), joinedload(models.Review.customer))
    if is_approved is not None:
        q = q.filter(models.Review.is_approved == is_approved)
    return q.order_by(models.Review.created_at.desc()).all()


@router.post("/{review_id}/approve", response_model=schemas.ReviewAdminOut)
def approve_review(review_id: str, db: Session = Depends(get_db)):
    review = db.get(models.Review, review_id)
    if not review:
        raise HTTPException(404, "التقييم غير موجود")
    review.is_approved = True
    db.commit()
    db.refresh(review)
    return review


@router.delete("/{review_id}", status_code=204)
def delete_review(review_id: str, db: Session = Depends(get_db)):
    review = db.get(models.Review, review_id)
    if not review:
        raise HTTPException(404, "التقييم غير موجود")
    db.delete(review)
    db.commit()
