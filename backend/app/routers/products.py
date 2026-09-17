from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/products", tags=["Products"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.ProductOut])
def list_products(
    category: Optional[models.ProductCategory] = None,
    low_stock_only: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(models.Product).filter(models.Product.is_active == True)  # noqa: E712
    if category:
        q = q.filter(models.Product.category == category)
    products = q.order_by(models.Product.name).all()
    if low_stock_only:
        products = [p for p in products if p.stock_status in ("low", "out")]
    return products


@router.post("/", response_model=schemas.ProductOut, status_code=201)
def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db)):
    if payload.sku:
        existing = db.query(models.Product).filter(models.Product.sku == payload.sku).first()
        if existing:
            raise HTTPException(400, "SKU مستخدم بالفعل لمنتج آخر")
    product = models.Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.get("/{product_id}", response_model=schemas.ProductOut)
def get_product(product_id: str, db: Session = Depends(get_db)):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    return product


@router.patch("/{product_id}", response_model=schemas.ProductOut)
def update_product(product_id: str, payload: schemas.ProductUpdate, db: Session = Depends(get_db)):
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=204)
def deactivate_product(product_id: str, db: Session = Depends(get_db)):
    """Soft-delete: products are never hard-deleted since inventory movements
    and past B2B order items reference them."""
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    product.is_active = False
    db.commit()
