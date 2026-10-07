"""Product photos: validation, storage, and public URLs.

Photos live in Supabase Storage, in a public-read bucket that only this
backend can write to (with the server-only secret key — never sent to any
browser). The database stores the object's key, e.g.
"products/<product_id>/<random>.webp"; every service turns a key into a URL
with `public_url()`, from one configured base, so the same row works in any
environment.

Configuration (backend/.env):
    SUPABASE_URL           https://<project-ref>.supabase.co
    SUPABASE_SECRET_KEY    server-only secret (Dashboard → Project Settings → API Keys)
    PRODUCT_IMAGES_BUCKET  optional, default "product-images"
    PRODUCT_IMAGE_BASE_URL optional override of the public base URL (e.g. a CDN)

Run `python -m app.product_images orphans` to list stored photos no product
references any more (add `--delete` to remove them).
"""
from __future__ import annotations

import io
import logging
import os
import sys
import uuid
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv
from PIL import Image, UnidentifiedImageError

load_dotenv()

log = logging.getLogger("uvicorn.error")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "")
BUCKET = os.getenv("PRODUCT_IMAGES_BUCKET", "product-images")
PUBLIC_BASE_URL = (
    os.getenv("PRODUCT_IMAGE_BASE_URL")
    or (f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}" if SUPABASE_URL else "")
).rstrip("/")

KEY_PREFIX = "products/"
MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 40_000_000          # e.g. 8000×5000 — far beyond any product photo
MIN_SIDE = 200                   # smaller than this can't fill a product card
# Pillow format → (content type, extension). Only these are accepted.
FORMATS = {"JPEG": ("image/jpeg", "jpg"), "PNG": ("image/png", "png"), "WEBP": ("image/webp", "webp")}
ALLOWED_CONTENT_TYPES = {ct for ct, _ in FORMATS.values()}
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
# Keys are unique per upload and never overwritten, so a URL's content never
# changes — browsers and CDNs may cache it for a year.
CACHE_CONTROL = "public, max-age=31536000, immutable"


def public_url(key: str | None) -> str | None:
    if not key or not PUBLIC_BASE_URL:
        return None
    return f"{PUBLIC_BASE_URL}/{key}"


class InvalidImage(ValueError):
    """The upload isn't an acceptable product photo (message is Arabic)."""


@dataclass
class ValidatedImage:
    data: bytes
    content_type: str
    extension: str
    width: int
    height: int


def validate_image(data: bytes, declared_type: str | None, filename: str | None) -> ValidatedImage:
    """Accepts only real, intact, still JPEG/PNG/WebP images within limits.
    The declared type and filename must agree with what the bytes really are
    — neither is trusted on its own."""
    if not data:
        raise InvalidImage("الملف فاضي")
    if len(data) > MAX_BYTES:
        raise InvalidImage("حجم الصورة أكبر من 5 ميجا")
    if declared_type not in ALLOWED_CONTENT_TYPES:
        raise InvalidImage("الصورة لازم تكون JPG أو PNG أو WEBP")
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise InvalidImage("امتداد الملف لازم يكون jpg أو png أو webp")
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            width, height = img.size
            frames = getattr(img, "n_frames", 1)
            if width * height > MAX_PIXELS:
                raise InvalidImage("أبعاد الصورة كبيرة جدًا")
            img.load()  # decodes every pixel: truncated/corrupt files fail here
    except InvalidImage:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise InvalidImage("الملف ده مش صورة صالحة أو تالف")
    if fmt not in FORMATS:
        raise InvalidImage("الصورة لازم تكون JPG أو PNG أو WEBP")
    content_type, extension = FORMATS[fmt]
    if content_type != declared_type or (extension != ext and not (extension == "jpg" and ext == "jpeg")):
        raise InvalidImage("نوع الملف مش مطابق لمحتواه — ارفعي الصورة الأصلية بامتدادها الصحيح")
    if frames > 1:
        raise InvalidImage("الصور المتحركة مش مدعومة — ارفعي صورة ثابتة")
    if min(width, height) < MIN_SIDE:
        raise InvalidImage(f"الصورة صغيرة جدًا — أقل ضلع لازم يكون {MIN_SIDE} بكسل على الأقل")
    return ValidatedImage(data, content_type, extension, width, height)


def new_key(product_id: str, extension: str) -> str:
    # Unguessable and unique per upload: no collisions, no overwrites.
    return f"{KEY_PREFIX}{product_id}/{uuid.uuid4().hex}.{extension}"


class StorageError(RuntimeError):
    pass


class SupabaseStorage:
    """The subset of the Supabase Storage REST API this app needs."""

    def __init__(self, url: str, secret_key: str, bucket: str, transport: httpx.BaseTransport | None = None):
        headers = {"apikey": secret_key}
        # Legacy service_role keys are JWTs and also go in Authorization;
        # the newer `sb_secret_…` keys are sent as `apikey` only.
        if secret_key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {secret_key}"
        self.bucket = bucket
        self._client = httpx.Client(base_url=f"{url}/storage/v1", headers=headers, timeout=30, transport=transport)
        self._bucket_ready = False

    def _check(self, res: httpx.Response, action: str) -> httpx.Response:
        if res.status_code >= 400:
            raise StorageError(f"{action} failed: HTTP {res.status_code} {res.text[:200]}")
        return res

    def ensure_bucket(self) -> None:
        """Creates the bucket (public read, size/type limits) or brings an
        existing one's settings in line — idempotent."""
        if self._bucket_ready:
            return
        settings = {"public": True, "file_size_limit": MAX_BYTES, "allowed_mime_types": sorted(ALLOWED_CONTENT_TYPES)}
        res = self._client.get(f"/bucket/{self.bucket}")
        if res.status_code == 200:
            self._check(self._client.put(f"/bucket/{self.bucket}", json=settings), "update bucket")
        else:
            self._check(self._client.post("/bucket", json={"id": self.bucket, "name": self.bucket, **settings}), "create bucket")
        self._bucket_ready = True

    def upload(self, key: str, data: bytes, content_type: str) -> None:
        self.ensure_bucket()
        self._check(
            self._client.post(
                f"/object/{self.bucket}/{key}",
                content=data,
                headers={"Content-Type": content_type, "cache-control": CACHE_CONTROL, "x-upsert": "false"},
            ),
            "upload",
        )

    def delete(self, keys: list[str]) -> None:
        if keys:
            self._check(self._client.request("DELETE", f"/object/{self.bucket}", json={"prefixes": keys}), "delete")

    def list_keys(self, prefix: str = KEY_PREFIX) -> list[str]:
        """Every object key under `prefix` (Storage lists one folder level at a time)."""
        keys, folders = [], [prefix]
        while folders:
            folder = folders.pop()
            offset = 0
            while True:
                res = self._check(
                    self._client.post(f"/object/list/{self.bucket}", json={"prefix": folder, "limit": 1000, "offset": offset}),
                    "list",
                )
                entries = res.json()
                for e in entries:
                    path = f"{folder.rstrip('/')}/{e['name']}"
                    if e.get("id") is None:
                        folders.append(path + "/")
                    else:
                        keys.append(path)
                if len(entries) < 1000:
                    break
                offset += 1000
        return keys


def secret_key_problem(key: str) -> str | None:
    """Why `key` can't be the server secret — None if it looks right. A
    public (publishable/anon) key can't create the bucket or upload: the
    bucket deliberately has no public write rules."""
    if key.startswith("sb_publishable_"):
        return "SUPABASE_SECRET_KEY holds a publishable key — use the project's *secret* key"
    if key.startswith("eyJ"):
        import base64
        import json as _json
        try:
            payload = key.split(".")[1]
            role = _json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("role")
        except (IndexError, ValueError):
            return "SUPABASE_SECRET_KEY isn't a valid key"
        if role != "service_role":
            return f"SUPABASE_SECRET_KEY is a '{role}' key — use the service_role (secret) key"
    return None


_storage: SupabaseStorage | None = None
_warned = False


def get_storage() -> SupabaseStorage | None:
    """The configured storage, or None if photos aren't set up (uploads then
    answer 503 instead of storing files somewhere the storefront can't see)."""
    global _storage, _warned
    if _storage is None and SUPABASE_URL and SUPABASE_SECRET_KEY:
        problem = secret_key_problem(SUPABASE_SECRET_KEY)
        if problem:
            if not _warned:
                log.error("Product photo storage disabled: %s.", problem)
                _warned = True
            return None
        _storage = SupabaseStorage(SUPABASE_URL, SUPABASE_SECRET_KEY, BUCKET)
    return _storage


def find_orphans(db, storage: SupabaseStorage) -> list[str]:
    from . import models

    referenced = {k for (k,) in db.query(models.Product.image_key).filter(models.Product.image_key.isnot(None))}
    return sorted(k for k in storage.list_keys() if k not in referenced)


if __name__ == "__main__":  # python -m app.product_images orphans [--delete]
    if sys.argv[1:2] != ["orphans"]:
        sys.exit("usage: python -m app.product_images orphans [--delete]")
    from .database import SessionLocal

    storage = get_storage()
    if storage is None:
        sys.exit("Product image storage isn't configured (SUPABASE_URL / SUPABASE_SECRET_KEY).")
    db = SessionLocal()
    try:
        orphans = find_orphans(db, storage)
    finally:
        db.close()
    print("\n".join(orphans) or "No orphaned product photos.")
    if orphans and "--delete" in sys.argv:
        storage.delete(orphans)
        print(f"Deleted {len(orphans)} orphaned photo(s).")
