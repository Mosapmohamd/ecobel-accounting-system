"""Promotions — the rules behind the admin Offer Builder.

KEEP IDENTICAL in ecobel-website and ecobel-accounting-system (backend/app/
promotions.py): the storefront prices carts and orders with it, the admin
previews offers with it.

The engine works on already-priced cart lines (a product's price is its sale
price or its product offer price — app/pricing.py) and never trusts amounts
from a browser. Rules, applied in this fixed order:

1. Candidate offers: status "active", now inside [starts_at, ends_at), usage
   limit not reached, the customer's own limit not reached (when the customer
   is known). Offers an order already holds ("held", when a pending order is
   edited) skip the status/date/limit checks — their use is already counted —
   but every condition is re-checked against the new cart.
2. Order: priority (higher first), then oldest first, then id — deterministic.
3. Bundles are never guessed from loose items: the customer adds a bundle
   as one group (`BundleGroup` — the offer, the chosen products, how many
   bundles). Each group is checked against the offer (a FIXED bundle —
   config.mode "combination" — must hold exactly its products and
   quantities; a CHOOSE bundle — mode "any" — exactly `bundle_quantity`
   eligible units) and costs `bundle_price` per bundle. Groups go first.
4. The other product offers (percentage, fixed_amount, buy_x_get_y) take
   loose product UNITS: a unit used by one offer (or sitting in a bundle) is
   never used by another, so no quantity is discounted twice. An offer that
   is not combinable applies only if no other offer applied before it, and
   once it applies no other offer does.
5. The coupon (app/checkout.py) applies to what is left after these offers.
6. Free-shipping offers come last (they can depend on the discounted
   subtotal) and follow the same combination rule.

Money is rounded to 0.01 EGP; a discount never exceeds what it discounts.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Optional

TYPES = ("bundle", "free_shipping", "percentage", "fixed_amount", "buy_x_get_y")
PRODUCT_TYPES = ("bundle", "percentage", "fixed_amount", "buy_x_get_y")
STATUSES = ("draft", "active", "inactive")


def _r(x: float) -> float:
    return round(x + 0.0, 2)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    # SQLite hands back naive datetimes; they're stored as UTC.
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _money(x: float) -> str:
    return f"{x:,.2f}".rstrip("0").rstrip(".")


# ---------------------------------------------------------------- data shapes
@dataclass
class Line:
    """One priced, orderable cart line (the price includes any product offer)."""
    product_id: str
    category_id: Optional[str]
    unit_price: float
    quantity: int


@dataclass
class Rule:
    id: str
    name: str
    type: str
    status: str = "active"
    priority: int = 0
    combinable: bool = False
    min_subtotal: Optional[float] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    usage_limit: Optional[int] = None
    used_count: int = 0
    per_customer_limit: Optional[int] = None
    config: dict = field(default_factory=dict)
    eligible_products: frozenset = frozenset()
    eligible_categories: frozenset = frozenset()
    reward_products: frozenset = frozenset()
    reward_categories: frozenset = frozenset()
    badge_text: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    # FIXED bundle contents: product_id -> units per bundle (default 1 each).
    eligible_quantities: dict = field(default_factory=dict)

    @property
    def fixed_bundle(self) -> bool:
        return self.type == "bundle" and self.config.get("mode") == "combination"

    def bundle_contents(self) -> dict:
        """product_id -> units per bundle, for a FIXED bundle."""
        return {pid: int(self.eligible_quantities.get(pid, 1)) for pid in sorted(self.eligible_products)}

    @property
    def restricted(self) -> bool:
        return bool(self.eligible_products or self.eligible_categories)

    @property
    def has_reward_targets(self) -> bool:
        return bool(self.reward_products or self.reward_categories)

    def matches(self, product_id: str, category_id: Optional[str], role: str = "eligible") -> bool:
        """Whether a product qualifies ('eligible') or can be the gift ('reward';
        without reward targets the gift comes from the eligible products)."""
        if role == "reward" and self.has_reward_targets:
            products, categories = self.reward_products, self.reward_categories
        else:
            products, categories = self.eligible_products, self.eligible_categories
        if not products and not categories:
            return True  # no restriction: every product
        return product_id in products or (category_id is not None and category_id in categories)

    def terms(self) -> dict:
        """Snapshot of what the customer was promised (stored with the order)."""
        return {
            "type": self.type, "priority": self.priority, "combinable": self.combinable,
            "min_subtotal": self.min_subtotal, "config": dict(self.config),
            "eligible_products": sorted(self.eligible_products), "eligible_categories": sorted(self.eligible_categories),
            "reward_products": sorted(self.reward_products), "reward_categories": sorted(self.reward_categories),
            "bundle_contents": self.bundle_contents() if self.fixed_bundle else None,
            "starts_at": self.starts_at.isoformat() if self.starts_at else None,
            "ends_at": self.ends_at.isoformat() if self.ends_at else None,
            "usage_limit": self.usage_limit, "per_customer_limit": self.per_customer_limit,
        }


@dataclass
class Applied:
    rule: Rule
    discount: float = 0.0
    shipping_discount: float = 0.0
    allocations: dict = field(default_factory=dict)   # product_id -> discount on that product
    units: dict = field(default_factory=dict)         # product_id -> units the offer used
    free_units: dict = field(default_factory=dict)    # product_id -> units given free (buy_x_get_y)
    detail: dict = field(default_factory=dict)        # e.g. {"bundles": 2}

    def snapshot(self) -> dict:
        return {"units": self.units, "free_units": self.free_units, "allocations": self.allocations, **self.detail}


# kind: "unavailable" (not running / limits — not shown to shoppers),
# "conflict" (another offer won), "condition" (the cart doesn't meet it yet).
@dataclass
class Skipped:
    rule: Rule
    reason: str
    kind: str = "condition"


@dataclass
class BundleGroup:
    """One bundle the customer added as a whole: `count` identical bundles
    of `items` (priced lines; quantity = units per bundle)."""
    promotion_id: str
    items: list
    count: int = 1


@dataclass
class BundleOutcome:
    """How one BundleGroup was priced — or why it can't be ordered."""
    group: BundleGroup
    rule: Optional[Rule]
    ok: bool
    reason: Optional[str] = None
    normal: float = 0.0     # regular price of the whole group (all bundles)
    price: float = 0.0      # what the group costs
    discount: float = 0.0
    allocations: dict = field(default_factory=dict)  # product_id -> discount

    def snapshot(self) -> dict:
        return {
            "count": self.group.count,
            "items": [{"product_id": l.product_id, "quantity": l.quantity, "unit_price": l.unit_price} for l in self.group.items],
            "normal": self.normal, "price": self.price, "discount": self.discount,
        }


@dataclass
class Result:
    applied: list = field(default_factory=list)
    skipped: list = field(default_factory=list)
    bundles: list = field(default_factory=list)  # BundleOutcome per input group, same order

    @property
    def bundle_issues(self) -> list:
        return [b for b in self.bundles if not b.ok]

    @property
    def discount(self) -> float:
        return _r(sum(a.discount for a in self.applied))

    @property
    def shipping_discount(self) -> float:
        return _r(sum(a.shipping_discount for a in self.applied))

    def allocations(self) -> dict:
        """product_id -> total promotion discount on that product."""
        out: dict = {}
        for a in self.applied:
            for pid, d in a.allocations.items():
                out[pid] = _r(out.get(pid, 0) + d)
        return out


# ---------------------------------------------------------------- availability
def schedule_state(rule: Rule, now: datetime) -> str:
    """draft / inactive / scheduled / active / expired — what admins see."""
    if rule.status != "active":
        return rule.status
    starts, ends = _aware(rule.starts_at), _aware(rule.ends_at)
    if starts and now < starts:
        return "scheduled"
    if ends and now >= ends:
        return "expired"
    return "active"


def unavailable_reason(rule: Rule, now: datetime, customer_uses: Optional[int]) -> Optional[str]:
    """Why an offer can't be used at all right now (None = it can)."""
    state = schedule_state(rule, now)
    if state != "active":
        return {"scheduled": "العرض لسه ما بدأش", "expired": "العرض انتهى"}.get(state, "العرض مش مفعّل")
    if rule.usage_limit is not None and rule.used_count >= rule.usage_limit:
        return "العرض وصل للحد الأقصى من الاستخدام"
    if rule.per_customer_limit is not None and customer_uses is not None and customer_uses >= rule.per_customer_limit:
        return "استخدمتي العرض ده قبل كده للحد المسموح"
    return None


def is_live(rule: Rule, now: datetime) -> bool:
    """Running now and not used up — what the storefront may advertise."""
    return unavailable_reason(rule, now, None) is None


def order_rules(rules: Iterable[Rule]) -> list[Rule]:
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    return sorted(rules, key=lambda r: (-r.priority, _aware(r.created_at) or epoch, r.id))


# ---------------------------------------------------------------- the engine
@dataclass(eq=False)  # identity equality: two units of one product are distinct
class _Unit:
    product_id: str
    category_id: Optional[str]
    price: float
    used: bool = False


def _units(lines: list[Line]) -> list[_Unit]:
    return [_Unit(l.product_id, l.category_id, float(l.unit_price)) for l in lines for _ in range(max(0, int(l.quantity)))]


def _take(applied: Applied, units: list[_Unit], discounts: list[float], free: bool = False) -> None:
    """Mark units as used by this offer and record per-product amounts."""
    for u, d in zip(units, discounts):
        u.used = True
        applied.units[u.product_id] = applied.units.get(u.product_id, 0) + 1
        applied.allocations[u.product_id] = _r(applied.allocations.get(u.product_id, 0) + d)
        if free:
            applied.free_units[u.product_id] = applied.free_units.get(u.product_id, 0) + 1


def _spread(units: list[_Unit], amount: float) -> list[float]:
    """Split `amount` over units in proportion to their prices (cent exact)."""
    total = sum(u.price for u in units)
    if total <= 0 or not units:
        return [0.0] * len(units)
    parts = [_r(amount * u.price / total) for u in units]
    parts[-1] = _r(amount - sum(parts[:-1]))
    return parts


def _limit(c: dict, multiple_key: str, max_key: str) -> Optional[int]:
    limit = None if c.get(multiple_key, True) else 1
    if c.get(max_key):
        limit = min(limit or int(c[max_key]), int(c[max_key]))
    return limit


def bundle_limit(rule: Rule) -> Optional[int]:
    """Most bundles of this offer one order may hold (None = no limit)."""
    return _limit(rule.config, "allow_multiple", "max_bundles")


def check_bundle(rule: Rule, group: BundleGroup) -> Optional[str]:
    """Why this group isn't a valid bundle of `rule` (None = it is)."""
    if rule.type != "bundle":
        return "العرض ده مش باقة"
    if group.count < 1:
        return "عدد الباقات لازم يكون 1 على الأقل"
    chosen: dict = {}
    for l in group.items:
        if l.quantity < 1:
            return "كمية غير صحيحة في الباقة"
        chosen[l.product_id] = chosen.get(l.product_id, 0) + int(l.quantity)
    if rule.fixed_bundle:
        if chosen != rule.bundle_contents():
            return "محتوى الباقة اتغيّر — شيليها من السلة وأضيفيها تاني من صفحة العرض"
        return None
    size = int(rule.config["bundle_quantity"])
    if sum(chosen.values()) != size:
        return f"الباقة لازم تكون {size} منتجات بالظبط"
    for l in group.items:
        if not rule.matches(l.product_id, l.category_id):
            return "في منتج في الباقة مش من منتجات العرض"
    if rule.config.get("distinct_products") and any(q > 1 for q in chosen.values()):
        return "منتجات الباقة لازم تكون مختلفة"
    return None


def _price_group(rule: Rule, group: BundleGroup) -> BundleOutcome:
    """count × bundle_price, never more than the regular price; the saving is
    spread over the group's products in proportion to their prices."""
    per_normal = sum(float(l.unit_price) * int(l.quantity) for l in group.items)
    price_each = float(rule.config["bundle_price"])
    normal = _r(per_normal * group.count)
    discount = _r(max(0.0, per_normal - price_each) * group.count)
    units = [_Unit(l.product_id, l.category_id, float(l.unit_price)) for l in group.items for _ in range(int(l.quantity) * group.count)]
    allocations: dict = {}
    for u, d in zip(units, _spread(units, discount)):
        allocations[u.product_id] = _r(allocations.get(u.product_id, 0) + d)
    return BundleOutcome(group, rule, True, None, normal, _r(normal - discount), discount, allocations)


def _percentage(rule: Rule, pool: list[_Unit]) -> tuple[Optional[Applied], Optional[str]]:
    c = rule.config
    if not pool:
        return None, "مفيش في السلة منتجات داخلة في العرض"
    chosen = sorted(pool, key=lambda u: (-u.price, u.product_id))
    if c.get("max_quantity"):
        chosen = chosen[: int(c["max_quantity"])]
    base = sum(u.price for u in chosen)
    discount = _r(base * float(c["percent"]) / 100)
    if c.get("max_discount") is not None:
        discount = min(discount, float(c["max_discount"]))
    discount = _r(min(discount, base))
    applied = Applied(rule, discount=discount, detail={"percent": float(c["percent"]), "discounted_units": len(chosen)})
    _take(applied, chosen, _spread(chosen, discount))
    return applied, None


def _fixed(rule: Rule, pool: list[_Unit]) -> tuple[Optional[Applied], Optional[str]]:
    c = rule.config
    if not pool:
        return None, "مفيش في السلة منتجات داخلة في العرض"
    amount = float(c["amount"])
    per = c.get("apply_per", "order")
    chosen = sorted(pool, key=lambda u: (-u.price, u.product_id))
    applied = Applied(rule)
    if per == "item":  # `amount` off each eligible unit (never below 0)
        if c.get("max_quantity"):
            chosen = chosen[: int(c["max_quantity"])]
        parts = [_r(min(amount, u.price)) for u in chosen]
        applied.discount = _r(sum(parts))
        _take(applied, chosen, parts)
    else:  # `amount` once per order, off the eligible products
        base = sum(u.price for u in chosen)
        applied.discount = _r(min(amount, base))
        _take(applied, chosen, _spread(chosen, applied.discount))
    applied.detail = {"amount": amount, "apply_per": per}
    return applied, None


def _buy_x_get_y(rule: Rule, avail: list[_Unit]) -> tuple[Optional[Applied], Optional[str]]:
    """Buy `buy_quantity` qualifying units, get `get_quantity` reward units
    free. The reward must be in the cart (it is stock-checked like any line);
    "cheapest" gives away the cheapest reward units, otherwise the dearest."""
    c = rule.config
    x, y = int(c["buy_quantity"]), int(c["get_quantity"])
    cheapest = c.get("reward_choice", "cheapest") == "cheapest"
    limit = _limit(c, "allow_multiple", "max_rewards")
    qualifying = sorted((u for u in avail if rule.matches(u.product_id, u.category_id)), key=lambda u: (-u.price, u.product_id))
    rewards = sorted((u for u in avail if rule.matches(u.product_id, u.category_id, "reward")),
                     key=lambda u: ((u.price if cheapest else -u.price), u.product_id))
    applied, rounds = Applied(rule), 0
    while limit is None or rounds < limit:
        gift = [u for u in rewards if not u.used][:y]
        if len(gift) < y:
            break
        gift_ids = {id(u) for u in gift}
        buy = [u for u in qualifying if not u.used and id(u) not in gift_ids][:x]
        if len(buy) < x:
            break
        _take(applied, buy, [0.0] * len(buy))
        _take(applied, gift, [u.price for u in gift], free=True)
        applied.discount = _r(applied.discount + sum(u.price for u in gift))
        rounds += 1
    if not rounds or applied.discount <= 0:
        n_q = len(qualifying)
        if n_q < x:
            return None, f"اشتري {x - n_q} كمان من منتجات العرض عشان تاخدي الهدية"
        if rule.has_reward_targets:
            return None, "أضيفي المنتج الهدية للسلة — هيتخصم سعره بالكامل"
        return None, f"أضيفي {max(1, x + y - n_q)} منتج كمان من منتجات العرض — هيتخصم مجانًا"
    applied.detail = {"rewards": rounds, "buy_quantity": x, "get_quantity": y}
    return applied, None


_HANDLERS = {"percentage": _percentage, "fixed_amount": _fixed}
CONFLICT = "العرض ده ما بيتجمعش مع عرض تاني اتطبق على طلبك"


def evaluate_products(
    rules: Iterable[Rule],
    lines: list[Line],
    *,
    now: datetime,
    customer_uses: Optional[dict] = None,
    held: Iterable[str] = (),
    bundles: Iterable[BundleGroup] = (),
) -> Result:
    """Product offers on a cart: `bundles` (groups the customer added as
    whole bundles) first, then the other offers on the loose `lines`.
    `customer_uses` maps offer id -> how many of this customer's other
    non-cancelled orders used it (None = customer unknown; per-customer
    limits are then checked at checkout). A group that can't be honoured
    comes back with ok=False and a reason — the cart must not be ordered
    like that (it is never silently priced differently)."""
    held = set(held)
    rules = list(rules)
    by_id = {r.id: r for r in rules}
    bundles = list(bundles)
    result = Result()
    units = _units(lines)
    subtotal = _r(sum(u.price for u in units) + sum(float(l.unit_price) * l.quantity * g.count for g in bundles for l in g.items))
    exclusive_taken = False

    def blocked(rule: Rule) -> Optional[tuple]:
        if rule.id not in held:
            reason = unavailable_reason(rule, now, None if customer_uses is None else customer_uses.get(rule.id, 0))
            if reason:
                return reason, "unavailable"
        if exclusive_taken or (result.applied and not rule.combinable):
            return CONFLICT, "conflict"
        if rule.min_subtotal and subtotal < rule.min_subtotal:
            return (f"الحد الأدنى للعرض {_money(rule.min_subtotal)} ج.م — فاضلك {_money(rule.min_subtotal - subtotal)} ج.م", "condition")
        return None

    # 1) bundles the customer added — grouped per offer, offers in rule order
    outcomes: list = [None] * len(bundles)
    for i, g in enumerate(bundles):
        if by_id.get(g.promotion_id) is None or by_id[g.promotion_id].type != "bundle":
            outcomes[i] = BundleOutcome(g, None, False, "عرض الباقة ده مش متاح دلوقتي")
    groups_of = [r for r in order_rules(r for r in rules if r.type == "bundle")
                 if any(g.promotion_id == r.id for g in bundles)]
    for rule in groups_of:
        mine = [i for i, g in enumerate(bundles) if g.promotion_id == rule.id]
        why = blocked(rule)
        if why is None:
            limit = bundle_limit(rule)
            if limit is not None and sum(bundles[i].count for i in mine) > limit:
                why = (f"أقصى عدد من الباقة دي في الطلب الواحد {limit}", "condition")
        if why is not None:
            reason = "عرض الباقة ده مش متاح دلوقتي" if why[1] == "unavailable" else why[0]
            for i in mine:
                outcomes[i] = BundleOutcome(bundles[i], rule, False, reason)
            continue
        applied = Applied(rule, detail={"bundles": 0, "groups": []})
        for i in mine:
            bad = check_bundle(rule, bundles[i])
            if bad:
                outcomes[i] = BundleOutcome(bundles[i], rule, False, bad)
                continue
            o = _price_group(rule, bundles[i])
            outcomes[i] = o
            applied.discount = _r(applied.discount + o.discount)
            for pid, d in o.allocations.items():
                applied.allocations[pid] = _r(applied.allocations.get(pid, 0) + d)
            for l in bundles[i].items:
                applied.units[l.product_id] = applied.units.get(l.product_id, 0) + int(l.quantity) * bundles[i].count
            applied.detail["bundles"] += bundles[i].count
            applied.detail["groups"].append(o.snapshot())
        if applied.detail["bundles"]:
            applied.detail["bundle_price"] = float(rule.config["bundle_price"])
            result.applied.append(applied)
            if not rule.combinable:
                exclusive_taken = True
    result.bundles = outcomes

    # 2) the other offers, on loose units
    for rule in order_rules(r for r in rules if r.type in PRODUCT_TYPES):
        if rule.type == "bundle":
            if rule.id not in {a.rule.id for a in result.applied} and rule.id not in {g.promotion_id for g in bundles}:
                if rule.id in held or unavailable_reason(rule, now, None) is None:
                    result.skipped.append(Skipped(rule, "أضيفي الباقة كاملة من صفحة العرض بزرار «أضيفي الباقة للسلة»"))
            continue
        why = blocked(rule)
        if why is not None:
            result.skipped.append(Skipped(rule, why[0], why[1]))
            continue
        avail = [u for u in units if not u.used]
        if rule.type == "buy_x_get_y":
            applied, reason = _buy_x_get_y(rule, avail)
        else:
            applied, reason = _HANDLERS[rule.type](rule, [u for u in avail if rule.matches(u.product_id, u.category_id)])
        if applied is None or applied.discount <= 0:
            result.skipped.append(Skipped(rule, reason or "العرض مش بيدّي خصم على السلة دي"))
            continue
        result.applied.append(applied)
        if not rule.combinable:
            exclusive_taken = True
    return result


def bundle_lines(bundles: Iterable[BundleGroup]) -> list[Line]:
    """Every unit inside the bundles, as plain lines (subtotals, shipping)."""
    return [Line(l.product_id, l.category_id, l.unit_price, int(l.quantity) * g.count) for g in bundles for l in g.items]


def evaluate_shipping(
    rules: Iterable[Rule],
    lines: list[Line],
    result: Result,
    *,
    now: datetime,
    city: Optional[str],
    shipping_fee: Optional[float],
    subtotal_after_discounts: float,
    customer_uses: Optional[dict] = None,
    held: Iterable[str] = (),
) -> Result:
    """Free-shipping offers, after product offers and the coupon. Shipping is
    one fee per order (per city — the shipping_rates table), so the first
    qualifying offer waives that whole fee.

    config: basis "after" (default; the subtotal after product offers and the
    coupon) or "before" (the subtotal before them); cities (empty = every
    city we deliver to); require_all_eligible (only when every item in the
    cart is an eligible product). min_subtotal is the threshold, measured on
    the eligible products only when the offer is restricted to some."""
    held = set(held)
    subtotal = sum(l.unit_price * l.quantity for l in lines)
    exclusive_taken = any(not a.rule.combinable for a in result.applied)
    waived = False
    for rule in order_rules(r for r in rules if r.type == "free_shipping"):
        if rule.id not in held:
            reason = unavailable_reason(rule, now, None if customer_uses is None else customer_uses.get(rule.id, 0))
            if reason:
                result.skipped.append(Skipped(rule, reason, "unavailable"))
                continue
        c = rule.config
        eligible = [l for l in lines if rule.matches(l.product_id, l.category_id)]
        if rule.restricted and not eligible:
            result.skipped.append(Skipped(rule, "مفيش في السلة منتجات داخلة في عرض الشحن المجاني"))
            continue
        if c.get("require_all_eligible") and len(eligible) < len(lines):
            result.skipped.append(Skipped(rule, "الشحن المجاني بيتطبق لما كل منتجات السلة تكون من منتجات العرض"))
            continue
        eligible_value = sum(l.unit_price * l.quantity for l in eligible)
        if c.get("basis", "after") == "before":
            basis = eligible_value if rule.restricted else subtotal
        else:
            ratio = (subtotal_after_discounts / subtotal) if subtotal else 0
            basis = (eligible_value * ratio) if rule.restricted else subtotal_after_discounts
        basis = _r(basis)
        threshold = rule.min_subtotal or 0
        if basis < threshold:
            result.skipped.append(Skipped(rule, f"فاضلك {_money(threshold - basis)} ج.م وتاخدي شحن مجاني"))
            continue
        cities = [x.strip() for x in (c.get("cities") or [])]
        if not city or not city.strip() or shipping_fee is None:
            result.skipped.append(Skipped(rule, "اختاري المحافظة عشان نطبّق الشحن المجاني"))
            continue
        if cities and city.strip() not in cities:
            result.skipped.append(Skipped(rule, "الشحن المجاني مش متاح للمحافظة دي"))
            continue
        if shipping_fee <= 0 or waived:
            continue  # already free — nothing left to waive, nothing to count
        if exclusive_taken or (result.applied and not rule.combinable):
            result.skipped.append(Skipped(rule, "العرض ده ما بيتجمعش مع عرض تاني اتطبق على طلبك", "conflict"))
            continue
        result.applied.append(Applied(rule, shipping_discount=_r(shipping_fee), detail={"city": city.strip(), "basis": basis}))
        waived = True
        if not rule.combinable:
            exclusive_taken = True
    return result


def describe(rule: Rule) -> str:
    """One line a shopper (or an admin) reads: what the offer gives."""
    c = rule.config
    t = rule.type
    if t == "bundle":
        if c.get("mode") == "combination":
            n = sum(rule.bundle_contents().values())
            text = f"باقة {n} منتجات بـ {_money(float(c['bundle_price']))} ج.م"
        else:
            text = f"اختاري {int(c['bundle_quantity'])} منتجات بـ {_money(float(c['bundle_price']))} ج.م"
    elif t == "free_shipping":
        text = f"شحن مجاني للطلبات من {_money(rule.min_subtotal)} ج.م" if rule.min_subtotal else "شحن مجاني"
    elif t == "percentage":
        text = f"خصم {_money(float(c['percent']))}%"
        if c.get("max_discount") is not None:
            text += f" (حتى {_money(float(c['max_discount']))} ج.م)"
    elif t == "fixed_amount":
        each = " على كل قطعة" if c.get("apply_per") == "item" else ""
        text = f"خصم {_money(float(c['amount']))} ج.م{each}"
    elif t == "buy_x_get_y":
        text = f"اشتري {int(c['buy_quantity'])} وخدي {int(c['get_quantity'])} هدية"
    else:
        text = rule.name
    if rule.min_subtotal and t != "free_shipping":
        text += f" — للطلبات من {_money(rule.min_subtotal)} ج.م"
    return text


def touches_cart(rule: Rule, lines: list[Line]) -> bool:
    """Whether an offer is relevant to this cart (worth a hint to the shopper)."""
    if not rule.restricted:
        return bool(lines)
    return any(rule.matches(l.product_id, l.category_id) or rule.matches(l.product_id, l.category_id, "reward") for l in lines)


# ---------------------------------------------------------------- database helpers
def rule_from_model(p) -> Rule:
    """A models.Promotion (with its targets loaded) as an engine Rule."""
    def ids(role, attr):
        return frozenset(getattr(t, attr) for t in p.targets if t.role == role and getattr(t, attr))
    return Rule(
        id=p.id, name=p.name, type=p.type, status=p.status, priority=p.priority or 0, combinable=bool(p.combinable),
        min_subtotal=p.min_subtotal, starts_at=_aware(p.starts_at), ends_at=_aware(p.ends_at),
        usage_limit=p.usage_limit, used_count=p.used_count or 0, per_customer_limit=p.per_customer_limit,
        config=dict(p.config or {}), badge_text=p.badge_text, description=p.description, created_at=_aware(p.created_at),
        eligible_products=ids("eligible", "product_id"), eligible_categories=ids("eligible", "category_id"),
        reward_products=ids("reward", "product_id"), reward_categories=ids("reward", "category_id"),
        eligible_quantities={t.product_id: int(getattr(t, "quantity", None) or 1)
                             for t in p.targets if t.role == "eligible" and t.product_id},
    )


def load_rules(db, models, *, include: Iterable[str] = (), lock_ids: Iterable[str] = ()) -> list[Rule]:
    """Active offers (plus `include` ids — those an order already holds).
    `lock_ids` are first locked FOR UPDATE in id order, so their usage
    counters are read and changed by one checkout at a time."""
    from sqlalchemy import or_
    from sqlalchemy.orm import selectinload

    lock_ids = sorted(set(lock_ids))
    if lock_ids:
        db.query(models.Promotion.id).filter(models.Promotion.id.in_(lock_ids)).order_by(models.Promotion.id).with_for_update().all()
    q = db.query(models.Promotion).filter(or_(models.Promotion.status == "active", models.Promotion.id.in_(list(include))))
    if lock_ids:
        q = q.populate_existing()  # read the counters as they are now that the rows are locked
    return [rule_from_model(p) for p in q.options(selectinload(models.Promotion.targets)).all()]


def customer_uses(db, models, customer_id: Optional[str], *, exclude_order_id: Optional[str] = None) -> Optional[dict]:
    """offer id -> number of this customer's non-cancelled orders that used it."""
    if not customer_id:
        return None
    from sqlalchemy import func

    q = (
        db.query(models.OrderPromotion.promotion_id, func.count(func.distinct(models.OrderPromotion.order_id)))
        .join(models.Order, models.Order.id == models.OrderPromotion.order_id)
        .filter(models.Order.customer_id == customer_id)
        .filter(models.Order.status != models.OrderStatus.cancelled)
    )
    if exclude_order_id:
        q = q.filter(models.Order.id != exclude_order_id)
    return dict(q.group_by(models.OrderPromotion.promotion_id).all())


def count_use(db, models, ids: Iterable[str], delta: int) -> None:
    """Add `delta` (+1 / -1) to these offers' usage counters in SQL — never a
    read-modify-write — and never below zero."""
    from sqlalchemy import case

    ids = sorted(set(ids))
    if not ids:
        return
    col = models.Promotion.used_count
    new = col + delta if delta > 0 else case((col + delta < 0, 0), else_=col + delta)
    db.query(models.Promotion).filter(models.Promotion.id.in_(ids)).update({col: new}, synchronize_session=False)
