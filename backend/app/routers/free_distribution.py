from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth, services
from ..database import get_db

router = APIRouter(prefix="/free-distribution", tags=["Free Distribution"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.FreeDistributionOut])
def list_distributions(db: Session = Depends(get_db)):
    return (
        db.query(models.FreeDistribution)
        .options(joinedload(models.FreeDistribution.items))
        .order_by(models.FreeDistribution.created_at.desc())
        .all()
    )


@router.post("/", response_model=schemas.FreeDistributionOut, status_code=201)
def create_distribution(payload: schemas.FreeDistributionCreate, db: Session = Depends(get_db)):
    if not payload.items:
        raise HTTPException(400, "لازم منتج واحد على الأقل في التوزيع")

    # Lock every product first, in id order (like checkout, so two requests
    # can't deadlock), and read their stock as it is now.
    ids = sorted({item.product_id for item in payload.items})
    products = {
        p.id: p for p in db.query(models.Product).filter(models.Product.id.in_(ids))
        .order_by(models.Product.id).with_for_update().populate_existing()
    }

    distribution = models.FreeDistribution(
        recipient_name=payload.recipient_name,
        recipient_type=payload.recipient_type,
        note=payload.note,
    )
    db.add(distribution)
    db.flush()

    for item_in in payload.items:
        product = products.get(item_in.product_id)
        if not product:
            raise HTTPException(404, f"منتج غير موجود: {item_in.product_id}")
        if item_in.quantity <= 0:
            raise HTTPException(400, "الكمية لازم تكون أكبر من صفر")

        db.add(models.FreeDistributionItem(
            distribution_id=distribution.id,
            product_id=product.id,
            quantity=item_in.quantity,
        ))

        # Stock out with no revenue — tracked purely as an inventory movement.
        services.apply_stock_movement(
            db, product, -item_in.quantity, models.MovementType.free_distribution,
            reference_id=distribution.id, note=f"عينات مجانية — {payload.recipient_name}",
        )

    db.commit()
    db.refresh(distribution)
    return distribution
