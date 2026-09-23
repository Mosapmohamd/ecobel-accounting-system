from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/routines", tags=["Routines"], dependencies=[Depends(auth.get_current_user)])


def _load(db: Session, routine_id: str) -> models.Routine | None:
    return (
        db.query(models.Routine)
        .options(joinedload(models.Routine.items).joinedload(models.RoutineItem.product))
        .filter(models.Routine.id == routine_id)
        .first()
    )


@router.get("/", response_model=List[schemas.RoutineOut])
def list_routines(db: Session = Depends(get_db)):
    return (
        db.query(models.Routine)
        .options(joinedload(models.Routine.items).joinedload(models.RoutineItem.product))
        .order_by(models.Routine.created_at.desc())
        .all()
    )


@router.post("/", response_model=schemas.RoutineOut, status_code=201)
def create_routine(payload: schemas.RoutineCreate, db: Session = Depends(get_db)):
    products = db.query(models.Product).filter(models.Product.id.in_(payload.product_ids)).all()
    if len(products) != len(set(payload.product_ids)):
        raise HTTPException(404, "في منتج أو أكتر مش موجود")

    routine = models.Routine(name=payload.name, description=payload.description)
    db.add(routine)
    db.flush()
    for i, pid in enumerate(payload.product_ids):
        db.add(models.RoutineItem(routine_id=routine.id, product_id=pid, position=i))
    db.commit()
    return _load(db, routine.id)


@router.patch("/{routine_id}", response_model=schemas.RoutineOut)
def update_routine(routine_id: str, payload: schemas.RoutineUpdate, db: Session = Depends(get_db)):
    routine = db.get(models.Routine, routine_id)
    if not routine:
        raise HTTPException(404, "الروتين غير موجود")

    data = payload.model_dump(exclude_unset=True)
    product_ids = data.pop("product_ids", None)
    for field, value in data.items():
        setattr(routine, field, value)

    if product_ids is not None:
        products = db.query(models.Product).filter(models.Product.id.in_(product_ids)).all()
        if len(products) != len(set(product_ids)):
            raise HTTPException(404, "في منتج أو أكتر مش موجود")
        db.query(models.RoutineItem).filter(models.RoutineItem.routine_id == routine_id).delete()
        for i, pid in enumerate(product_ids):
            db.add(models.RoutineItem(routine_id=routine_id, product_id=pid, position=i))

    db.commit()
    return _load(db, routine_id)


@router.delete("/{routine_id}", status_code=204)
def delete_routine(routine_id: str, db: Session = Depends(get_db)):
    routine = db.get(models.Routine, routine_id)
    if not routine:
        raise HTTPException(404, "الروتين غير موجود")
    db.delete(routine)
    db.commit()
