from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/categories", tags=["Categories"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(models.Category).order_by(models.Category.name).all()


@router.post("/", response_model=schemas.CategoryOut, status_code=201)
def create_category(payload: schemas.CategoryCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "اسم الفئة مطلوب")
    existing = db.query(models.Category).filter(models.Category.name == name).first()
    if existing:
        return existing  # idempotent — adding an existing category name just returns it
    category = models.Category(name=name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category
