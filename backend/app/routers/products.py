import logging
from contextlib import contextmanager
from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas, auth, product_images, services
from ..database import get_db


logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/products", tags=["Products"], dependencies=[Depends(auth.get_current_user)])


@router.get("/", response_model=List[schemas.ProductOut])
def list_products(
    category_id: Optional[str] = None,
    low_stock_only: bool = False,
    status: Literal["active", "archived", "all"] = "active",
    db: Session = Depends(get_db),
):
    """Active products by default; `status=archived` lists archived ones
    (so they can be restored), `status=all` both."""
    q = db.query(models.Product).options(selectinload(models.Product.images))
    if status == "active":
        q = q.filter(models.Product.is_active == True)  # noqa: E712
    elif status == "archived":
        q = q.filter(models.Product.is_active == False)  # noqa: E712
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

    # Opening stock goes through the inventory ledger like every other stock
    # change, so the product's quantity always equals the sum of its
    # movements (stock history and reports stay complete).
    data = payload.model_dump()
    opening = data.pop("quantity", 0) or 0
    product = models.Product(**data, quantity=0)
    db.add(product)
    db.flush()
    if opening > 0:
        services.apply_stock_movement(db, product, opening, models.MovementType.restock, note="رصيد افتتاحي عند إضافة المنتج")
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
    """"Delete" = archive (soft delete): the product leaves the storefront
    and the active list, but its row stays, because orders, B2B orders,
    stock movements, free distributions, offers, routines and reviews refer
    to it — their history must never change. Restore with PATCH
    `is_active: true`. Photos are kept."""
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    product.is_active = False
    db.commit()


def _product_or_404(db: Session, product_id: str) -> models.Product:
    product = db.get(models.Product, product_id)
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    return product


def _require_storage(storage):
    if storage is None:
        raise HTTPException(503, "تخزين صور المنتجات مش متجهز على السيرفر — كلّمي المسؤول التقني")
    return storage


async def _store(product: models.Product, file: UploadFile, storage) -> str:
    """Validate the upload fully and store it under a new unique key."""
    # Read at most one byte past the limit — never buffer an arbitrarily big upload.
    data = await file.read(product_images.MAX_BYTES + 1)
    try:
        image = product_images.validate_image(data, file.content_type, file.filename)
    except product_images.InvalidImage as e:
        raise HTTPException(400, str(e))
    key = product_images.new_key(product.id, image.extension)
    try:
        await run_in_threadpool(storage.upload, key, image.data, image.content_type)
    except product_images.StorageError:
        logger.exception("Product photo upload failed")
        raise HTTPException(502, "تعذر حفظ الصورة دلوقتي — حاولي تاني بعد شوية")
    return key


def _delete_unreferenced(db: Session, storage, keys: list) -> None:
    """Remove stored files only once no product or product photo row refers
    to them any more (checked after the change was committed). Blocking —
    async endpoints call it through run_in_threadpool."""
    keys = [k for k in keys if k]
    if not keys or storage is None:
        return
    used = {k for (k,) in db.query(models.Product.image_key).filter(models.Product.image_key.in_(keys))}
    used |= {k for (k,) in db.query(models.ProductImage.image_key).filter(models.ProductImage.image_key.in_(keys))}
    unused = [k for k in keys if k not in used]
    if unused:
        _delete_quietly(storage, unused)


def _photo_or_404(product: models.Product, image_id: str) -> models.ProductImage:
    photo = next((i for i in product.images if i.id == image_id), None)
    if photo is None:
        raise HTTPException(404, "الصورة غير موجودة")
    return photo


def _renumber(product: models.Product) -> None:
    for position, photo in enumerate(sorted(product.images, key=lambda i: i.position)):
        photo.position = position


def _lock_product(db: Session, product_id: str) -> models.Product:
    """The product re-read with a row lock (FOR UPDATE, held until commit)
    and its photos fresh from the database: changes to one product's photos
    happen one at a time, so the photo limit and "first photo becomes the
    main one" hold under concurrent requests. Taken after any upload — never
    while waiting on Storage."""
    db.expire_all()
    product = db.query(models.Product).filter(models.Product.id == product_id).with_for_update().one_or_none()
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    return product


@contextmanager
def _locked_product(db: Session, product_id: str):
    """The product under its row lock for one change; the block commits.
    Any error inside rolls back right here, so the lock never outlives the
    block (it must not wait for the request's teardown — see below).

    A lock wait blocks its thread, so this only ever runs off the event loop
    (sync endpoints, or run_in_threadpool from async ones): a request
    waiting on the event loop would stall every request in this process,
    including the one holding the lock — a deadlock."""
    try:
        yield _lock_product(db, product_id)
    except BaseException:
        db.rollback()
        raise


def _gallery_full(product: models.Product) -> bool:
    return bool(product.image_key) and len(product.images) >= models.PRODUCT_IMAGES_MAX


def _gallery_full_error() -> HTTPException:
    return HTTPException(400, f"وصلتي للحد الأقصى: صورة رئيسية و{models.PRODUCT_IMAGES_MAX} صور إضافية")


async def _apply_upload(storage, new_key: str, change):
    """Run `change` (lock, edit, commit — blocking) off the event loop. If it
    fails, the file just stored for it is removed again: no orphans.

    Only ordinary errors (`Exception`) remove it. A cancellation may arrive
    after `change` has committed a row that points at the file, so then the
    file is kept: at worst an orphan (`python -m app.product_images orphans`),
    never a photo whose file is gone. Rollback is `_locked_product`'s job."""
    try:
        return await run_in_threadpool(change)
    except Exception:
        await run_in_threadpool(_delete_quietly, storage, [new_key])
        raise


@router.post("/{product_id}/image", response_model=schemas.ProductOut)
async def upload_product_image(
    product_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage=Depends(product_images.get_storage),
):
    """Upload or replace a product's main photo (staff only — the router
    requires a staff token). The file is fully validated, stored under a new
    unique key, and the old photo is removed once nothing refers to it."""
    product = _product_or_404(db, product_id)
    _require_storage(storage)
    key = await _store(product, file, storage)

    def point_at_new_photo():
        with _locked_product(db, product_id) as product:
            old_key, product.image_key = product.image_key, key
            db.commit()
            return old_key

    old_key = await _apply_upload(storage, key, point_at_new_photo)
    await run_in_threadpool(_delete_unreferenced, db, storage, [old_key])
    return _product_or_404(db, product_id)


@router.delete("/{product_id}/image", response_model=schemas.ProductOut)
def remove_product_image(product_id: str, db: Session = Depends(get_db), storage=Depends(product_images.get_storage)):
    """Remove a product's main photo (staff only). The first additional
    photo, if any, becomes the main one; otherwise the storefront shows the
    standard fallback."""
    with _locked_product(db, product_id) as product:
        old_key = product.image_key
        if old_key:
            _require_storage(storage)
        promoted = product.images[0] if product.images else None
        if old_key and promoted is not None:
            product.image_key = promoted.image_key
            product.images.remove(promoted)
            _renumber(product)
        else:
            product.image_key = None
        db.commit()
    _delete_unreferenced(db, storage, [old_key])
    return _product_or_404(db, product_id)


@router.post("/{product_id}/images", response_model=schemas.ProductOut)
async def add_product_photo(
    product_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage=Depends(product_images.get_storage),
):
    """Add one photo (staff only). A product without a main photo gets it as
    its main photo; otherwise it's appended to the additional photos. The
    limit is checked before uploading (fast answer) and again under the
    product's lock after uploading (concurrent requests can't exceed it)."""
    product = _product_or_404(db, product_id)
    _require_storage(storage)
    if _gallery_full(product):
        raise _gallery_full_error()
    key = await _store(product, file, storage)

    def attach():
        with _locked_product(db, product_id) as product:
            if _gallery_full(product):
                raise _gallery_full_error()
            if not product.image_key:
                product.image_key = key
            else:
                position = max((i.position for i in product.images), default=-1) + 1
                product.images.append(models.ProductImage(image_key=key, position=position))
            db.commit()

    await _apply_upload(storage, key, attach)
    return _product_or_404(db, product_id)


@router.put("/{product_id}/images/order", response_model=schemas.ProductOut)
def reorder_product_photos(product_id: str, payload: schemas.ProductImagesOrder, db: Session = Depends(get_db)):
    """Set the display order of the additional photos — the list must name
    each of them exactly once."""
    with _locked_product(db, product_id) as product:
        by_id = {i.id: i for i in product.images}
        if len(payload.image_ids) != len(by_id) or set(payload.image_ids) != set(by_id):
            raise HTTPException(400, "ترتيب الصور مش مطابق لصور المنتج الحالية — حدّثي الصفحة وحاولي تاني")
        for position, image_id in enumerate(payload.image_ids):
            by_id[image_id].position = position
        db.commit()
    return _product_or_404(db, product_id)


@router.put("/{product_id}/images/{image_id}", response_model=schemas.ProductOut)
async def replace_product_photo(
    product_id: str,
    image_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage=Depends(product_images.get_storage),
):
    """Replace one additional photo's file, keeping its place in the order."""
    product = _product_or_404(db, product_id)
    _photo_or_404(product, image_id)
    _require_storage(storage)
    key = await _store(product, file, storage)

    def swap_file():
        with _locked_product(db, product_id) as product:
            photo = _photo_or_404(product, image_id)  # it may have been removed meanwhile
            old_key, photo.image_key = photo.image_key, key
            db.commit()
            return old_key

    old_key = await _apply_upload(storage, key, swap_file)
    await run_in_threadpool(_delete_unreferenced, db, storage, [old_key])
    return _product_or_404(db, product_id)


@router.delete("/{product_id}/images/{image_id}", response_model=schemas.ProductOut)
def remove_product_photo(
    product_id: str, image_id: str, db: Session = Depends(get_db), storage=Depends(product_images.get_storage)
):
    """Remove one additional photo; its file is deleted once unreferenced."""
    with _locked_product(db, product_id) as product:
        photo = _photo_or_404(product, image_id)
        _require_storage(storage)
        old_key = photo.image_key
        product.images.remove(photo)
        _renumber(product)
        db.commit()
    _delete_unreferenced(db, storage, [old_key])
    return _product_or_404(db, product_id)


@router.post("/{product_id}/images/{image_id}/primary", response_model=schemas.ProductOut)
def make_photo_primary(product_id: str, image_id: str, db: Session = Depends(get_db)):
    """Make an additional photo the main one; the previous main photo takes
    its place among the additional photos. No file is copied or deleted."""
    with _locked_product(db, product_id) as product:
        photo = _photo_or_404(product, image_id)
        if product.image_key:
            product.image_key, photo.image_key = photo.image_key, product.image_key
        else:
            product.image_key = photo.image_key
            product.images.remove(photo)
            _renumber(product)
        db.commit()
    return _product_or_404(db, product_id)


def _delete_quietly(storage, keys: list[str]) -> None:
    """Best effort: a file that fails to delete is only an orphan (found by
    `python -m app.product_images orphans`), never a broken product."""
    try:
        storage.delete(keys)
    except product_images.StorageError:
        logger.exception("Could not delete product photo(s) %s", keys)
