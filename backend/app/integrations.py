"""Settings → Integrations: what the admin can VERIFY about the storefront's
Meta Pixel from here — and nothing more. See docs/INTEGRATIONS.md.

Measured here:
- the live storefront's Pixel setup, by fetching its homepage on demand
  (STOREFRONT_URL, server config only — never a URL from the request): the
  Pixel ID it serves (its <noscript> beacon) and whether its
  Content-Security-Policy lets the Pixel run, without opening more than needed;
- the orders that qualify for a Purchase event (completed AND paid: delivered,
  cash on delivery — app/order_ledger.py), from this database.

NOT measured here (said so on the page, never estimated):
- how many events browsers actually sent (they go from the customer's
  browser straight to Meta; this backend never sees them);
- what Meta received, matched or attributed (only Meta Events Manager / a
  Meta API with an access token can tell — none is configured).
"""
from __future__ import annotations

import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional
from urllib.parse import urlsplit

from sqlalchemy import func

from . import models, order_ledger

EVENTS_MANAGER_URL = "https://business.facebook.com/events_manager2/"
PIXEL_SCRIPT_HOST = "https://connect.facebook.net"
PIXEL_BEACON_HOST = "https://www.facebook.com"
_MAX_BYTES = 2_000_000
_TIMEOUT = 8

# The storefront's browser events (ecobel-website frontend/src/lib/metaPixel.ts).
EVENTS = [
    {"name": "PageView", "trigger": "أول تحميل لأي صفحة وكل انتقال لصفحة جديدة", "server_side_data": False},
    {"name": "ViewContent", "trigger": "عرض صفحة منتج", "server_side_data": False},
    {"name": "Search", "trigger": "صفحة نتائج البحث عن كلمة", "server_side_data": False},
    {"name": "AddToCart", "trigger": "إضافة فعلية للسلة (منتج، روتين، باقة)", "server_side_data": False},
    {"name": "InitiateCheckout", "trigger": "العميلة بتبدأ تملى بيانات إتمام الطلب", "server_side_data": False},
    {"name": "Purchase", "trigger": "طلب اتسلّم ودفع عند الاستلام (مكتمل ومدفوع) — مش عند إنشاء الطلب",
     "server_side_data": True},
]


def storefront_url() -> Optional[str]:
    """The public storefront address to check, from server config — or None."""
    raw = os.getenv("STOREFRONT_URL", "").strip()
    if not raw:
        return None
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        return None
    return f"{parts.scheme}://{parts.netloc}/"


# ---------------------------------------------------------------- storefront check
@dataclass
class Fetched:
    status: int
    headers: dict
    body: str
    location: Optional[str] = None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # report redirects, never follow them
        return None


def fetch(url: str) -> Fetched:
    opener = urllib.request.build_opener(_NoRedirect())
    req = urllib.request.Request(url, headers={"User-Agent": "EcoBel-Integrations-Check/1.0"})
    try:
        with opener.open(req, timeout=_TIMEOUT) as r:
            body = r.read(_MAX_BYTES).decode("utf-8", errors="replace")
            return Fetched(r.status, {k.lower(): v for k, v in r.headers.items()}, body)
    except urllib.error.HTTPError as e:
        return Fetched(e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, "", (e.headers or {}).get("Location"))


def _csp(header: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in header.split(";"):
        bits = part.strip().split()
        if bits:
            out[bits[0].lower()] = bits[1:]
    return out


def _too_broad(sources: list[str]) -> list[str]:
    """Sources that would let far more than Meta's two hosts in."""
    return [s for s in sources if s in ("*", "https:", "http:") or "*.facebook" in s or "*.fbcdn" in s]


def check_storefront(url: Optional[str], fetcher: Optional[Callable[[str], Fetched]] = None) -> dict:
    """Fetches the storefront homepage once and reports what's verifiable."""
    fetcher = fetcher or fetch
    checked_at = datetime.now(timezone.utc)
    checks: list[dict] = []

    def add(name, status, detail):
        checks.append({"name": name, "status": status, "detail": detail})

    if not url:
        add("عنوان المتجر", "info", "STOREFRONT_URL مش متظبط في إعدادات السيرفر — مفيش متجر نفحصه.")
        return {"checked_at": checked_at, "url": None, "reachable": False, "pixel_id": None, "checks": checks}
    try:
        page = fetcher(url)
    except Exception as e:  # network error, timeout, TLS…
        add("الوصول للمتجر", "fail", f"تعذر الوصول للمتجر ({type(e).__name__}).")
        return {"checked_at": checked_at, "url": url, "reachable": False, "pixel_id": None, "checks": checks}

    if 300 <= page.status < 400:
        add("الوصول للمتجر", "warn", f"المتجر بيحوّل لعنوان تاني ({page.status} → {page.location or '؟'}) — عدّلي STOREFRONT_URL للعنوان النهائي.")
        return {"checked_at": checked_at, "url": url, "reachable": True, "pixel_id": None, "checks": checks}
    if page.status != 200:
        add("الوصول للمتجر", "fail", f"المتجر رد بـ HTTP {page.status}.")
        return {"checked_at": checked_at, "url": url, "reachable": True, "pixel_id": None, "checks": checks}
    add("الوصول للمتجر", "ok", "المتجر رد بـ HTTP 200.")

    ids = sorted(set(re.findall(r"facebook\.com/tr\?id=(\d{6,20})", page.body)))
    pixel_id = ids[0] if len(ids) == 1 else None
    if not ids:
        add("Meta Pixel على المتجر", "info", "المتجر مش شغّال عليه Pixel (NEXT_PUBLIC_META_PIXEL_ID فاضي) — مفيش تتبع.")
    elif len(ids) > 1:
        add("Meta Pixel على المتجر", "warn", f"أكتر من Pixel ID في الصفحة: {', '.join(ids)}.")
    else:
        add("Meta Pixel على المتجر", "ok", f"المتجر شغّال عليه Pixel ID {pixel_id}.")

    csp = _csp(page.headers.get("content-security-policy", ""))
    if not csp:
        add("سياسة أمان المحتوى (CSP)", "warn", "المتجر مش باعت Content-Security-Policy (طبيعي في بيئة التطوير بس).")
    else:
        broad = sorted({s for d in ("script-src", "connect-src", "img-src", "default-src") for s in _too_broad(csp.get(d, []))})
        if broad:
            add("CSP مش أوسع من اللازم", "fail", f"مصادر واسعة جدًا: {' '.join(broad)}")
        else:
            add("CSP مش أوسع من اللازم", "ok", "مفيش wildcards — Meta مسموح لها بعنوانين محددين بس.")
        if ids:
            missing = [f"{d} {h}" for d, h in (("script-src", PIXEL_SCRIPT_HOST), ("connect-src", PIXEL_BEACON_HOST), ("img-src", PIXEL_BEACON_HOST))
                       if h not in csp.get(d, [])]
            if missing:
                add("CSP بيسمح للـ Pixel يشتغل", "fail", "ناقص: " + "، ".join(missing))
            else:
                add("CSP بيسمح للـ Pixel يشتغل", "ok", "سكريبت Meta ورسايله مسموحة.")
        elif any("facebook" in s for d in csp.values() for s in d):
            add("CSP من غير Pixel", "warn", "الـ CSP فيه عناوين Meta مع إن الـ Pixel مقفول.")
    return {"checked_at": checked_at, "url": url, "reachable": True, "pixel_id": pixel_id, "checks": checks}


# ---------------------------------------------------------------- purchase-eligible orders
def purchase_eligible(db, now: Optional[datetime] = None) -> dict:
    """Orders that qualify for a Purchase event — completed AND paid
    (delivered + cash on delivery), dated by their delivery (the staff status
    change; the order's last update for deliveries before that audit
    existed). Value = order total, as recognized at delivery."""
    now = now or datetime.now(timezone.utc)
    orders = (
        db.query(models.Order)
        .filter(models.Order.status == models.OrderStatus.delivered)
        .filter(models.Order.payment_method == order_ledger.CASH_ON_DELIVERY)
        .all()
    )
    delivered_at = dict(
        db.query(models.OrderStatusChange.order_id, func.max(models.OrderStatusChange.created_at))
        .filter(models.OrderStatusChange.to_status == models.OrderStatus.delivered.value)
        .group_by(models.OrderStatusChange.order_id)
        .all()
    )

    def when(o):
        at = delivered_at.get(o.id) or o.updated_at or o.created_at
        return at if at.tzinfo else at.replace(tzinfo=timezone.utc)

    dated = [(o, when(o)) for o in orders]

    def window(days):
        since = now - timedelta(days=days)
        rows = [o for o, at in dated if at >= since]
        return {"orders": len(rows), "value": round(sum(o.total_amount for o in rows), 2)}

    return {
        "last_7_days": window(7),
        "last_30_days": window(30),
        "all_time": {"orders": len(dated), "value": round(sum(o.total_amount for o, _ in dated), 2)},
        "last_delivered_at": max((at for _, at in dated), default=None),
        "undated": sum(1 for o in orders if o.id not in delivered_at),
    }
