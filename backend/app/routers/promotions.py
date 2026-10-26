"""The Offers page's API — cart-level offers the storefront applies at
checkout (bundles, free shipping, % and fixed discounts, Buy X Get Y). The
rules themselves live in app/promotions.py (shared with ecobel-website); this
router only stores offers and checks them before they can go live.

Per-product sale prices stay in the `offers` table and are edited through
/offers; the list here shows them too (type "product_price") so the admin
sees every offer in one place."""
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from .. import auth, cairo_time, models, promotions, schemas
from ..database import get_db

router = APIRouter(prefix="/promotions", tags=["Promotions"], dependencies=[Depends(auth.get_current_user)])

NOT_FOUND = "العرض غير موجود"
TERMS_LOCKED = "العرض ده اتستخدم في طلبات، فشروطه مش هتتغير — اعملي نسخة منه وعدّلي النسخة"
States = Literal["draft", "scheduled", "active", "expired", "inactive"]
ListTypes = Literal["bundle", "free_shipping", "percentage", "fixed_amount", "buy_x_get_y", "product_price"]
STATE_KEYS = ("draft", "scheduled", "active", "expired", "inactive")
Sorts = Literal["newest", "oldest", "name", "priority", "starts", "ends", "usage"]


# ---------------------------------------------------------------- validation
def _bad(message: str):
    raise HTTPException(400, message)


def _int(c: dict, key: str, label: str, lo: int, hi: int, required: bool = True) -> Optional[int]:
    v = c.get(key)
    if v in (None, ""):
        if required:
            _bad(f"اكتبي {label}")
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not lo <= v <= hi:
        _bad(f"{label} لازم يكون رقم صحيح من {lo} لـ {hi}")
    return int(v)


def _num(c: dict, key: str, label: str, *, gt: float = 0, le: float = 10_000_000, required: bool = True) -> Optional[float]:
    v = c.get(key)
    if v in (None, ""):
        if required:
            _bad(f"اكتبي {label}")
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not gt < v <= le:
        _bad(f"{label} لازم يكون أكبر من {gt:g}" + (f" ومش أكتر من {le:g}" if le < 10_000_000 else ""))
    return round(float(v), 2)


def _choice(c: dict, key: str, options: tuple, default: str) -> str:
    v = c.get(key, default)
    if v not in options:
        _bad("اختيار غير صحيح في إعدادات العرض")
    return v


def _flag(c: dict, key: str, default: bool) -> bool:
    v = c.get(key, default)
    if not isinstance(v, bool):
        _bad("اختيار غير صحيح في إعدادات العرض")
    return v


def _clean_config(db: Session, p: schemas.PromotionIn) -> dict:
    """Only the known settings of the offer's type, each range-checked."""
    c, t = p.config or {}, p.type
    if t == "bundle":
        mode = _choice(c, "mode", ("any", "combination"), "any")
        out = {"mode": mode, "bundle_price": _num(c, "bundle_price", "سعر الباقة"),
               "allow_multiple": _flag(c, "allow_multiple", True),
               "max_bundles": _int(c, "max_bundles", "أقصى عدد باقات في الطلب", 1, 100, required=False)}
        if mode == "combination":  # FIXED bundle: exact products and units
            if not p.eligible_product_ids or p.eligible_category_ids:
                _bad("الباقة الثابتة لازم تكون من منتجات محددة (من غير فئات)")
            out["bundle_quantity"] = sum(_quantities(p).values())
            if out["bundle_quantity"] < 2:
                _bad("الباقة لازم يكون فيها قطعتين على الأقل")
        else:  # CHOOSE bundle: the customer picks bundle_quantity eligible units
            out["bundle_quantity"] = _int(c, "bundle_quantity", "عدد منتجات الباقة", 2, 50)
            out["distinct_products"] = _flag(c, "distinct_products", False)
        return out
    if t == "free_shipping":
        cities = c.get("cities") or []
        if not isinstance(cities, list) or not all(isinstance(x, str) for x in cities):
            _bad("اختيار غير صحيح للمحافظات")
        cities = sorted({x.strip() for x in cities if x.strip()})
        if cities:
            known = {r[0] for r in db.query(models.ShippingRate.city).filter(models.ShippingRate.is_active == True).all()}  # noqa: E712
            unknown = [x for x in cities if x not in known]
            if unknown:
                _bad(f"محافظات مش موجودة في أسعار الشحن المفعّلة: {'، '.join(unknown)}")
        return {"basis": _choice(c, "basis", ("after", "before"), "after"), "cities": cities,
                "require_all_eligible": _flag(c, "require_all_eligible", False)}
    if t == "percentage":
        return {"percent": _num(c, "percent", "نسبة الخصم", le=100),
                "max_discount": _num(c, "max_discount", "أقصى خصم", required=False),
                "max_quantity": _int(c, "max_quantity", "أقصى عدد قطع عليها خصم", 1, 1000, required=False)}
    if t == "fixed_amount":
        per = _choice(c, "apply_per", ("order", "item"), "order")
        return {"amount": _num(c, "amount", "مبلغ الخصم"), "apply_per": per,
                "max_quantity": _int(c, "max_quantity", "أقصى عدد قطع عليها خصم", 1, 1000, required=False) if per == "item" else None}
    # buy_x_get_y
    return {"buy_quantity": _int(c, "buy_quantity", "عدد القطع المطلوب شراؤها", 1, 50),
            "get_quantity": _int(c, "get_quantity", "عدد القطع الهدية", 1, 50),
            "reward_choice": _choice(c, "reward_choice", ("cheapest", "most_expensive"), "cheapest"),
            "allow_multiple": _flag(c, "allow_multiple", True),
            "max_rewards": _int(c, "max_rewards", "أقصى عدد هدايا في الطلب", 1, 100, required=False)}


def _quantities(p: schemas.PromotionIn) -> dict[str, int]:
    """Units per bundle of each product of a FIXED bundle (1 unless set)."""
    out = {}
    for pid in sorted(set(p.eligible_product_ids)):
        n = p.product_quantities.get(pid, 1)
        if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= 50:
            _bad("الكمية من كل منتج في الباقة لازم تكون من 1 لـ 50")
        out[pid] = n
    return out


def _fixed_bundle(p: schemas.PromotionIn) -> bool:
    return p.type == "bundle" and (p.config or {}).get("mode") == "combination"


def _check_targets(db: Session, p: schemas.PromotionIn) -> None:
    if p.type != "buy_x_get_y" and (p.reward_product_ids or p.reward_category_ids):
        _bad("منتجات الهدية بتتحدد في عروض «اشتري واحصلي على هدية» بس")
    product_ids = set(p.eligible_product_ids) | set(p.reward_product_ids)
    category_ids = set(p.eligible_category_ids) | set(p.reward_category_ids)
    if product_ids:
        found = {r[0] for r in db.query(models.Product.id).filter(models.Product.id.in_(product_ids)).all()}
        if found != product_ids:
            _bad("في منتج مختار مش موجود — حدّثي الصفحة واختاري تاني")
    if category_ids:
        found = {r[0] for r in db.query(models.Category.id).filter(models.Category.id.in_(category_ids)).all()}
        if found != category_ids:
            _bad("في فئة مختارة مش موجودة — حدّثي الصفحة واختاري تاني")


def _validate(db: Session, p: schemas.PromotionIn) -> tuple[str, dict]:
    name = p.name.strip()
    if not name:
        _bad("اكتبي اسم للعرض")
    if p.starts_at and p.ends_at and p.starts_at >= p.ends_at:
        _bad("تاريخ البداية لازم يكون قبل تاريخ النهاية")
    _check_targets(db, p)
    config = _clean_config(db, p)
    if p.type == "bundle" and config["mode"] == "combination":
        qty = _quantities(p)
        prices = dict(db.query(models.Product.id, models.Product.sale_price).filter(models.Product.id.in_(list(qty))).all())
        if config["bundle_price"] >= sum(prices.get(pid, 0) * n for pid, n in qty.items()):
            _bad("سعر الباقة لازم يكون أقل من مجموع أسعار منتجاتها")
    return name, config


def _check_can_go_live(p_status: str, ends_at: Optional[datetime]) -> None:
    if p_status == "active" and ends_at is not None and promotions._aware(ends_at) <= cairo_time.now_utc():
        _bad("تاريخ نهاية العرض فات — غيّريه قبل التفعيل")


# ---------------------------------------------------------------- helpers
def _get(db: Session, promotion_id: str, *, lock: bool = False) -> models.Promotion:
    q = db.query(models.Promotion).filter(models.Promotion.id == promotion_id)
    if lock:
        q = q.with_for_update()
    p = q.options(selectinload(models.Promotion.targets)).first()
    if not p:
        raise HTTPException(404, NOT_FOUND)
    return p


def _orders_counts(db: Session, ids: list[str]) -> dict[str, int]:
    if not ids:
        return {}
    rows = (
        db.query(models.OrderPromotion.promotion_id, func.count(func.distinct(models.OrderPromotion.order_id)))
        .join(models.Order, models.Order.id == models.OrderPromotion.order_id)
        .filter(models.OrderPromotion.promotion_id.in_(ids))
        .filter(models.Order.status != models.OrderStatus.cancelled)
        .group_by(models.OrderPromotion.promotion_id)
        .all()
    )
    return dict(rows)


def _ever_used(db: Session, promotion_id: str) -> bool:
    """Any order (cancelled ones included) ever received this offer."""
    return db.query(models.OrderPromotion.id).filter(models.OrderPromotion.promotion_id == promotion_id).first() is not None


def _out(db: Session, p: models.Promotion, orders_count: int, used: bool, names: dict) -> schemas.PromotionOut:
    rule = promotions.rule_from_model(p)

    def targets(role, attr, kind):
        return [schemas.PromotionTargetOut(id=getattr(t, attr), name=names[kind].get(getattr(t, attr), "—"), quantity=t.quantity or 1)
                for t in p.targets if t.role == role and getattr(t, attr)]

    return schemas.PromotionOut(
        id=p.id, name=p.name, description=p.description, badge_text=p.badge_text, type=p.type, status=p.status,
        state=promotions.schedule_state(rule, cairo_time.now_utc()), summary=promotions.describe(rule),
        starts_at=p.starts_at, ends_at=p.ends_at, priority=p.priority, combinable=p.combinable,
        min_subtotal=p.min_subtotal, usage_limit=p.usage_limit, per_customer_limit=p.per_customer_limit,
        used_count=p.used_count, orders_count=orders_count, terms_locked=used, config=p.config or {},
        eligible_products=targets("eligible", "product_id", "products"),
        eligible_categories=targets("eligible", "category_id", "categories"),
        reward_products=targets("reward", "product_id", "products"),
        reward_categories=targets("reward", "category_id", "categories"),
        created_by=p.created_by, updated_by=p.updated_by, created_at=p.created_at, updated_at=p.updated_at,
    )


def _names(db: Session, promos: list[models.Promotion]) -> dict:
    pids = {t.product_id for p in promos for t in p.targets if t.product_id}
    cids = {t.category_id for p in promos for t in p.targets if t.category_id}
    products = dict(db.query(models.Product.id, models.Product.name).filter(models.Product.id.in_(pids)).all()) if pids else {}
    categories = dict(db.query(models.Category.id, models.Category.name).filter(models.Category.id.in_(cids)).all()) if cids else {}
    return {"products": products, "categories": categories}


def _detail(db: Session, p: models.Promotion) -> schemas.PromotionOut:
    used = _ever_used(db, p.id) or p.used_count > 0
    return _out(db, p, _orders_counts(db, [p.id]).get(p.id, 0), used, _names(db, [p]))


def _set_targets(p: models.Promotion, data: schemas.PromotionIn) -> None:
    qty = _quantities(data) if _fixed_bundle(data) else {}
    p.targets = (
        [models.PromotionTarget(role="eligible", product_id=x, quantity=qty.get(x, 1)) for x in sorted(set(data.eligible_product_ids))]
        + [models.PromotionTarget(role="eligible", category_id=x) for x in sorted(set(data.eligible_category_ids))]
        + [models.PromotionTarget(role="reward", product_id=x) for x in sorted(set(data.reward_product_ids))]
        + [models.PromotionTarget(role="reward", category_id=x) for x in sorted(set(data.reward_category_ids))]
    )


def _terms(p: models.Promotion) -> tuple:
    return (p.type, p.config or {}, p.min_subtotal,
            sorted((t.role, t.product_id or "", t.category_id or "", t.quantity or 1) for t in p.targets))


# ---------------------------------------------------------------- endpoints
def _product_offer_state(o: models.Offer, now: datetime) -> str:
    if not o.is_active:
        return "inactive"
    return "active" if cairo_time.not_ended(o.expires_at) else "expired"


def _product_offer_out(o: models.Offer, now: datetime) -> schemas.PromotionOut:
    """A per-product sale price as a row of the unified list."""
    product = o.product
    original = product.sale_price if product else 0
    return schemas.PromotionOut(
        source="product_offer", id=o.id, name=o.title, type="product_price",
        status="active" if o.is_active else "inactive", state=_product_offer_state(o, now),
        summary=f"سعر العرض {o.offer_price:,.0f} ج.م بدل {original:,.0f} ج.م",
        starts_at=None, ends_at=o.expires_at, priority=0, combinable=True, used_count=0,
        config={"product_id": o.product_id, "offer_price": o.offer_price, "original_price": original},
        eligible_products=[schemas.PromotionTargetOut(id=o.product_id, name=product.name if product else "—")],
        created_at=o.created_at, updated_at=o.created_at,
    )


@router.get("/", response_model=schemas.PromotionPage)
def list_promotions(
    q: Optional[str] = Query(None, max_length=100),
    type: Optional[ListTypes] = None,
    state: Optional[States] = None,
    sort: Sorts = "newest",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Every offer — cart offers and per-product sale prices, whatever their
    state — searched, filtered (type / state), sorted and paged. "Scheduled"
    and "expired" depend on the clock, so the state filter runs here, not in
    SQL — fine for the number of offers a shop keeps. `counts` are per state
    for the current search and type, before the state filter."""
    now = cairo_time.now_utc()
    term = f"%{q.strip()}%" if q and q.strip() else None
    rows: list = []  # (state, sort keys..., kind, object)
    if type != "product_price":
        query = db.query(models.Promotion).options(selectinload(models.Promotion.targets))
        if type:
            query = query.filter(models.Promotion.type == type)
        if term:
            query = query.filter(or_(models.Promotion.name.ilike(term), models.Promotion.badge_text.ilike(term),
                                     models.Promotion.description.ilike(term)))
        for p in query.all():
            rows.append({"state": promotions.schedule_state(promotions.rule_from_model(p), now), "obj": p, "kind": "promotion",
                         "name": p.name, "created": p.created_at, "priority": p.priority, "starts": p.starts_at,
                         "ends": p.ends_at, "usage": p.used_count, "id": p.id})
    if type in (None, "product_price"):
        query = db.query(models.Offer).options(selectinload(models.Offer.product))
        if term:
            query = query.outerjoin(models.Product, models.Product.id == models.Offer.product_id).filter(
                or_(models.Offer.title.ilike(term), models.Product.name.ilike(term)))
        for o in query.all():
            rows.append({"state": _product_offer_state(o, now), "obj": o, "kind": "product_offer", "name": o.title,
                         "created": o.created_at, "priority": 0, "starts": None, "ends": o.expires_at, "usage": 0, "id": o.id})
    counts = {"total": len(rows), **{k: 0 for k in STATE_KEYS}}
    for r in rows:
        counts[r["state"]] += 1
    if state:
        rows = [r for r in rows if r["state"] == state]
    far = datetime.max.replace(tzinfo=now.tzinfo)
    near = datetime.min.replace(tzinfo=now.tzinfo)
    aware = promotions._aware
    key = {
        "newest": lambda r: (-(aware(r["created"]) or near).timestamp(), r["id"]),
        "oldest": lambda r: ((aware(r["created"]) or near).timestamp(), r["id"]),
        "name": lambda r: (r["name"].casefold(), r["id"]),
        "priority": lambda r: (-r["priority"], r["name"].casefold(), r["id"]),
        "starts": lambda r: (aware(r["starts"]) or near, r["id"]),
        "ends": lambda r: (aware(r["ends"]) or far, r["id"]),
        "usage": lambda r: (-r["usage"], r["id"]),
    }[sort]
    rows.sort(key=key)
    total = len(rows)
    page = rows[offset: offset + limit]
    promos = [r["obj"] for r in page if r["kind"] == "promotion"]
    ids = [p.id for p in promos]
    used_counts = _orders_counts(db, ids)
    ever = {r[0] for r in db.query(models.OrderPromotion.promotion_id).filter(models.OrderPromotion.promotion_id.in_(ids)).distinct()} if ids else set()
    names = _names(db, promos)
    items = [
        _out(db, r["obj"], used_counts.get(r["id"], 0), r["id"] in ever or r["obj"].used_count > 0, names)
        if r["kind"] == "promotion" else _product_offer_out(r["obj"], now)
        for r in page
    ]
    return schemas.PromotionPage(items=items, total=total, limit=limit, offset=offset, counts=counts)


@router.get("/{promotion_id}", response_model=schemas.PromotionOut)
def get_promotion(promotion_id: str, db: Session = Depends(get_db)):
    return _detail(db, _get(db, promotion_id))


@router.post("/", response_model=schemas.PromotionOut, status_code=201)
def create_promotion(payload: schemas.PromotionIn, db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user)):
    name, config = _validate(db, payload)
    _check_can_go_live(payload.status, payload.ends_at)
    p = models.Promotion(
        name=name, description=(payload.description or "").strip() or None,
        badge_text=(payload.badge_text or "").strip() or None, type=payload.type, status=payload.status,
        starts_at=payload.starts_at, ends_at=payload.ends_at, priority=payload.priority, combinable=payload.combinable,
        min_subtotal=payload.min_subtotal or None, usage_limit=payload.usage_limit,
        per_customer_limit=payload.per_customer_limit, config=config, used_count=0,
        created_by=user.username, updated_by=user.username,
    )
    _set_targets(p, payload)
    db.add(p)
    db.commit()
    return _detail(db, _get(db, p.id))


@router.put("/{promotion_id}", response_model=schemas.PromotionOut)
def update_promotion(promotion_id: str, payload: schemas.PromotionIn, db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user)):
    """Replaces the offer's settings. Once an order has used the offer its
    terms (type, settings, products, minimum) are fixed, so past orders stay
    explainable and an edited order is re-priced on the terms it got —
    names, dates, limits, status, priority and combining can still change."""
    p = _get(db, promotion_id, lock=True)
    name, config = _validate(db, payload)
    _check_can_go_live(payload.status, payload.ends_at)
    if _ever_used(db, p.id) or p.used_count > 0:
        probe = models.Promotion(type=payload.type, config=config, min_subtotal=payload.min_subtotal or None)
        _set_targets(probe, payload)  # never added to the session — only compared
        if _terms(probe) != _terms(p):
            raise HTTPException(409, TERMS_LOCKED)
    else:
        p.type, p.config, p.min_subtotal = payload.type, config, payload.min_subtotal or None
        _set_targets(p, payload)
    p.name = name
    p.description = (payload.description or "").strip() or None
    p.badge_text = (payload.badge_text or "").strip() or None
    p.status = payload.status
    p.starts_at, p.ends_at = payload.starts_at, payload.ends_at
    p.priority, p.combinable = payload.priority, payload.combinable
    p.usage_limit, p.per_customer_limit = payload.usage_limit, payload.per_customer_limit
    p.updated_by = user.username
    db.commit()
    return _detail(db, _get(db, p.id))


def _set_status(db: Session, promotion_id: str, status: str, user: models.User) -> schemas.PromotionOut:
    p = _get(db, promotion_id, lock=True)
    if status == "active":
        _check_can_go_live("active", p.ends_at)
    p.status = status
    p.updated_by = user.username
    db.commit()
    return _detail(db, _get(db, p.id))


@router.post("/{promotion_id}/activate", response_model=schemas.PromotionOut)
def activate_promotion(promotion_id: str, db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user)):
    """Live now — or from its start date, if that is still ahead (scheduled)."""
    return _set_status(db, promotion_id, "active", user)


@router.post("/{promotion_id}/deactivate", response_model=schemas.PromotionOut)
def deactivate_promotion(promotion_id: str, db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user)):
    """Stops the offer for new carts and orders; orders that already got it
    keep it."""
    return _set_status(db, promotion_id, "inactive", user)


@router.post("/{promotion_id}/duplicate", response_model=schemas.PromotionOut, status_code=201)
def duplicate_promotion(promotion_id: str, db: Session = Depends(get_db), user: models.User = Depends(auth.get_current_user)):
    """A draft copy with the same settings and no usage."""
    src = _get(db, promotion_id)
    p = models.Promotion(
        name=f"{src.name} (نسخة)"[:120], description=src.description, badge_text=src.badge_text, type=src.type,
        status="draft", starts_at=src.starts_at, ends_at=src.ends_at, priority=src.priority, combinable=src.combinable,
        min_subtotal=src.min_subtotal, usage_limit=src.usage_limit, per_customer_limit=src.per_customer_limit,
        config=dict(src.config or {}), used_count=0, created_by=user.username, updated_by=user.username,
    )
    p.targets = [models.PromotionTarget(role=t.role, product_id=t.product_id, category_id=t.category_id, quantity=t.quantity or 1)
                 for t in src.targets]
    db.add(p)
    db.commit()
    return _detail(db, _get(db, p.id))


@router.delete("/{promotion_id}", status_code=204)
def delete_promotion(promotion_id: str, db: Session = Depends(get_db)):
    """Only an offer no order ever used can be deleted — a used one is
    deactivated instead, so order history keeps pointing at a real offer."""
    p = _get(db, promotion_id, lock=True)
    if _ever_used(db, p.id) or p.used_count > 0:
        raise HTTPException(409, "العرض ده اتستخدم في طلبات فمينفعش يتمسح — وقّفيه بدل المسح")
    db.delete(p)  # its targets go with it
    db.commit()


@router.post("/preview", response_model=schemas.PromotionPreviewOut)
def preview_promotion(payload: schemas.PromotionPreviewIn, db: Session = Depends(get_db)):
    """Runs an offer (saved or not) on a sample cart, as if it were live —
    the same rules checkout uses, on today's prices (product sale prices
    included). Nothing is saved."""
    data = payload.promotion
    name, config = _validate(db, data)
    rule = promotions.Rule(
        id="preview", name=name, type=data.type, priority=data.priority, combinable=True,
        min_subtotal=data.min_subtotal or None, config=config, badge_text=data.badge_text,
        eligible_products=frozenset(data.eligible_product_ids), eligible_categories=frozenset(data.eligible_category_ids),
        reward_products=frozenset(data.reward_product_ids), reward_categories=frozenset(data.reward_category_ids),
        eligible_quantities=_quantities(data) if _fixed_bundle(data) else {},
    )
    wanted: dict[str, int] = {}
    for it in payload.items:
        wanted[it.product_id] = wanted.get(it.product_id, 0) + it.quantity
    products = {p.id: p for p in db.query(models.Product).filter(models.Product.id.in_(list(wanted))).all()}
    if set(products) != set(wanted):
        _bad("في منتج في السلة التجريبية مش موجود")
    now = cairo_time.now_utc()
    offer_rows = (
        db.query(models.Offer.product_id, func.min(models.Offer.offer_price))
        .filter(models.Offer.product_id.in_(list(wanted)))
        .filter(models.Offer.is_active == True)  # noqa: E712
        .filter(or_(models.Offer.expires_at.is_(None), models.Offer.expires_at > now))
        .group_by(models.Offer.product_id)
        .all()
    )
    offer_price = dict(offer_rows)
    lines = []
    for pid, qty in wanted.items():
        prod = products[pid]
        price = offer_price.get(pid)
        unit = price if price is not None and price < prod.sale_price else prod.sale_price
        lines.append(promotions.Line(pid, prod.category_id, unit, qty))
    subtotal = round(sum(l.unit_price * l.quantity for l in lines), 2)

    if data.type == "bundle":  # the sample cart is one bundle, as the customer adds it
        result = promotions.evaluate_products([rule], [], now=now, bundles=[promotions.BundleGroup(rule.id, lines, 1)])
        bad = result.bundle_issues
        if bad:
            result.skipped.append(promotions.Skipped(rule, bad[0].reason))
    else:
        result = promotions.evaluate_products([rule], lines, now=now)
    fee = None
    if payload.city and payload.city.strip():
        rate = db.query(models.ShippingRate).filter(models.ShippingRate.city == payload.city.strip(), models.ShippingRate.is_active == True).first()  # noqa: E712
        fee = rate.fee if rate else None
    discount = result.discount
    promotions.evaluate_shipping([rule], lines, result, now=now, city=payload.city, shipping_fee=fee,
                                 subtotal_after_discounts=subtotal - discount)
    applied = result.applied[0] if result.applied else None
    skipped = next((s.reason for s in result.skipped), None)
    allocations = result.allocations()
    free = applied.free_units if applied else {}
    shipping_discount = result.shipping_discount
    charged_fee = None if fee is None else round(fee - shipping_discount, 2)
    return schemas.PromotionPreviewOut(
        lines=[schemas.PromotionPreviewLine(
            product_id=l.product_id, product_name=products[l.product_id].name, quantity=l.quantity,
            unit_price=l.unit_price, line_total=round(l.unit_price * l.quantity, 2),
            discount=allocations.get(l.product_id, 0), free_units=free.get(l.product_id, 0),
        ) for l in lines],
        subtotal=subtotal, applied=applied is not None,
        reason=None if applied else (skipped or ("اختاري محافظة عشان تجربي الشحن المجاني" if data.type == "free_shipping" else "العرض مش بيدّي خصم على السلة دي")),
        discount=discount, shipping_fee=charged_fee, shipping_discount=shipping_discount,
        total=round(subtotal - discount + (charged_fee or 0), 2), summary=promotions.describe(rule),
        detail=applied.detail if applied else {},
    )
