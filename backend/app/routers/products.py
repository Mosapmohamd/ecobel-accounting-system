from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/products", tags=["Products"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.ProductOut])
def list_products(
    category_id: Optional[str] = None,
    low_stock_only: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(models.Product).filter(models.Product.is_active == True)  # noqa: E712
    if category_id:
        q = q.filter(models.Product.category_id == category_id)
    products = q.order_by(models.Product.name).all()
    if low_stock_only:
        products = [p for p in products if p.stock_status in ("low", "out")]
    return products


@router.post("/", response_model=schemas.ProductOut, status_code=201)
def create_product(payload: schemas.ProductCreate, db: Session = Depends(get_db)):
    category = db.get(models.Category, payload.category_id)
    if not category:
        raise HTTPException(404, "الفئة غير موجودة")
    if payload.sku:
        existing_sku = db.query(models.Product).filter(models.Product.sku == payload.sku).first()
        if existing_sku:
            raise HTTPException(400, "SKU مستخدم بالفعل لمنتج آخر")

    # Prevent two active products with the same name in the same category —
    # the practical definition of "the same product" here.
    duplicate = (
        db.query(models.Product)
        .filter(models.Product.is_active == True)  # noqa: E712
        .filter(models.Product.category_id == payload.category_id)
        .filter(func.lower(func.trim(models.Product.name)) == payload.name.strip().lower())
        .first()
    )
    if duplicate:
        raise HTTPException(400, "منتج بنفس الاسم موجود بالفعل في نفس الفئة")

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
    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data and data["category_id"]:
        if not db.get(models.Category, data["category_id"]):
            raise HTTPException(404, "الفئة غير موجودة")

    new_name = data.get("name", product.name)
    new_category_id = data.get("category_id", product.category_id)
    duplicate = (
        db.query(models.Product)
        .filter(models.Product.id != product.id)
        .filter(models.Product.is_active == True)  # noqa: E712
        .filter(models.Product.category_id == new_category_id)
        .filter(func.lower(func.trim(models.Product.name)) == new_name.strip().lower())
        .first()
    )
    if duplicate:
        raise HTTPException(400, "منتج بنفس الاسم موجود بالفعل في نفس الفئة")

    for field, value in data.items():
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
