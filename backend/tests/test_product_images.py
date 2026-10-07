"""Product photo lifecycle — validation, storage, replace/remove, orphans and
access control. Storage is an in-memory stand-in (the Supabase driver's
requests are checked separately below). Throwaway SQLite DB.
"""
import io
import json
import os
import sys
import tempfile

if "app.database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
    os.environ.pop("SECRET_KEY", None)

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import auth, models, product_images  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'img_staff'})}"}


class MemoryStorage:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.fail_upload = False

    def upload(self, key, data, content_type):
        if self.fail_upload:
            raise product_images.StorageError("down")
        assert key not in self.objects, "keys are never overwritten"
        self.objects[key] = (data, content_type)

    def delete(self, keys):
        for k in keys:
            self.objects.pop(k, None)

    def list_keys(self, prefix="products/"):
        return [k for k in self.objects if k.startswith(prefix)]


storage = MemoryStorage()


@pytest.fixture(scope="module", autouse=True)
def seed():
    app.dependency_overrides[product_images.get_storage] = lambda: storage
    db = SessionLocal()
    db.add(models.User(username="img_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="img_cat", name="فئة الصور"))
    db.add_all([
        models.Product(id="img1", name="Photo Product", category_id="img_cat", sale_price=100, quantity=5),
        models.Product(id="img2", name="Other Product", category_id="img_cat", sale_price=100, quantity=5),
    ])
    db.commit()
    db.close()
    yield
    app.dependency_overrides.pop(product_images.get_storage, None)


def image_bytes(fmt="PNG", size=(400, 300), **save):
    buf = io.BytesIO()
    Image.new("RGB", size, (181, 86, 107)).save(buf, format=fmt, **save)
    return buf.getvalue()


def upload(pid="img1", data=None, name="photo.png", ctype="image/png", headers=H):
    return client.post(f"/products/{pid}/image", files={"file": (name, data if data is not None else image_bytes(), ctype)}, headers=headers)


def key_of(pid):
    db = SessionLocal()
    try:
        return db.get(models.Product, pid).image_key
    finally:
        db.close()


def test_upload_stores_a_unique_key_and_returns_the_public_url(monkeypatch):
    monkeypatch.setattr(product_images, "PUBLIC_BASE_URL", "https://cdn.example/storage/v1/object/public/product-images")
    res = upload()
    assert res.status_code == 200, res.text
    key = key_of("img1")
    assert key.startswith("products/img1/") and key.endswith(".png")
    assert storage.objects[key][1] == "image/png"
    assert res.json()["image_url"] == f"https://cdn.example/storage/v1/object/public/product-images/{key}"


@pytest.mark.parametrize("fmt,name,ctype", [("JPEG", "p.jpg", "image/jpeg"), ("JPEG", "p.jpeg", "image/jpeg"), ("WEBP", "p.webp", "image/webp")])
def test_all_supported_formats(fmt, name, ctype):
    res = upload("img2", image_bytes(fmt), name, ctype)
    assert res.status_code == 200, res.text
    assert key_of("img2").endswith({"JPEG": ".jpg", "WEBP": ".webp"}[fmt])


def test_replace_removes_the_old_photo():
    upload()
    old = key_of("img1")
    assert upload(data=image_bytes("JPEG"), name="new.jpg", ctype="image/jpeg").status_code == 200
    new = key_of("img1")
    assert new != old and new in storage.objects and old not in storage.objects


def test_remove_clears_the_reference_and_the_file():
    upload()
    key = key_of("img1")
    res = client.delete("/products/img1/image", headers=H)
    assert res.status_code == 200 and res.json()["image_url"] is None
    assert key_of("img1") is None and key not in storage.objects
    assert client.delete("/products/img1/image", headers=H).status_code == 200  # nothing to remove: still fine


@pytest.mark.parametrize("data,name,ctype,fragment", [
    (b"<?php echo 1; ?>", "evil.jpg", "image/jpeg", "مش صورة صالحة"),            # not an image, named .jpg
    (image_bytes("PNG"), "x.jpg", "image/jpeg", "مش مطابق"),                     # PNG claiming to be JPEG
    (image_bytes("PNG"), "x.png", "image/jpeg", "مش مطابق"),                     # declared type ≠ content
    (image_bytes("GIF"), "x.gif", "image/gif", "JPG أو PNG أو WEBP"),             # unsupported type
    (b"<svg xmlns='http://www.w3.org/2000/svg'/>", "x.svg", "image/svg+xml", "JPG أو PNG أو WEBP"),
    (image_bytes("PNG"), "photo.exe", "image/png", "امتداد"),                     # bad extension
    (image_bytes("PNG")[:200], "cut.png", "image/png", "تالف"),                   # truncated / corrupt
    (image_bytes("PNG", size=(120, 120)), "tiny.png", "image/png", "صغيرة"),      # too small
    (b"", "empty.png", "image/png", "فاضي"),
])
def test_rejects_invalid_files_with_arabic_reasons(data, name, ctype, fragment):
    before = dict(storage.objects)
    res = upload("img2", data, name, ctype)
    assert res.status_code == 400 and fragment in res.json()["detail"], res.text
    assert storage.objects == before


def test_rejects_oversized_files_without_reading_them_whole():
    big = image_bytes("PNG") + b"\0" * (product_images.MAX_BYTES + 10)
    res = upload("img2", big)
    assert res.status_code == 400 and "5 ميجا" in res.json()["detail"]


def test_rejects_decompression_bombs():
    bomb = image_bytes("PNG", size=(9000, 5000))  # 45 MP of one colour compresses to a tiny file
    assert len(bomb) < product_images.MAX_BYTES
    res = upload("img2", bomb)
    assert res.status_code == 400 and "أبعاد" in res.json()["detail"]


def test_rejects_animated_images():
    buf = io.BytesIO()
    frames = [Image.new("RGB", (300, 300), c) for c in ((255, 0, 0), (0, 255, 0))]
    frames[0].save(buf, format="WEBP", save_all=True, append_images=frames[1:])
    res = upload("img2", buf.getvalue(), "anim.webp", "image/webp")
    assert res.status_code == 400 and "المتحركة" in res.json()["detail"]


def test_storage_failure_leaves_the_product_unchanged():
    upload()
    before = key_of("img1")
    storage.fail_upload = True
    try:
        res = upload(data=image_bytes("JPEG"), name="n.jpg", ctype="image/jpeg")
    finally:
        storage.fail_upload = False
    assert res.status_code == 502 and key_of("img1") == before and before in storage.objects


def test_unconfigured_storage_answers_503_instead_of_storing_locally():
    app.dependency_overrides[product_images.get_storage] = lambda: None
    try:
        res = upload()
    finally:
        app.dependency_overrides[product_images.get_storage] = lambda: storage
    assert res.status_code == 503


def test_only_staff_can_upload_or_remove():
    assert upload(headers={}).status_code == 401
    assert client.delete("/products/img1/image").status_code == 401
    # A storefront customer's token is not a staff token.
    customer = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'cust_1', 'type': 'customer'})}"}
    assert upload(headers=customer).status_code == 401
    assert client.delete("/products/img1/image", headers=customer).status_code == 401


def test_unknown_product_is_404():
    assert upload("nope").status_code == 404
    assert client.delete("/products/nope/image", headers=H).status_code == 404


def test_find_orphans_lists_unreferenced_files_only():
    upload()
    storage.objects["products/img1/stale.png"] = (b"x", "image/png")
    db = SessionLocal()
    try:
        assert product_images.find_orphans(db, storage) == ["products/img1/stale.png"]
    finally:
        db.close()


def test_public_keys_are_refused_as_the_server_secret():
    import base64

    def jwt(role):
        payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
        return f"eyJhbGciOiJIUzI1NiJ9.{payload}.sig"

    assert "publishable" in product_images.secret_key_problem("sb_publishable_abc")
    assert "anon" in product_images.secret_key_problem(jwt("anon"))
    assert product_images.secret_key_problem(jwt("service_role")) is None
    assert product_images.secret_key_problem("sb_secret_abc") is None


# ---------------- Supabase Storage driver: the exact requests it makes ----------------
def test_supabase_driver_requests():
    calls = []
    store = {"bucket": None, "objects": {}}

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append((req.method, req.url.path, dict(req.headers)))
        path = req.url.path
        if path == "/storage/v1/bucket/product-images" and req.method == "GET":
            return httpx.Response(200 if store["bucket"] else 400, json=store["bucket"] or {"error": "Bucket not found"})
        if path == "/storage/v1/bucket" and req.method == "POST":
            store["bucket"] = json.loads(req.content)
            return httpx.Response(200, json={"name": "product-images"})
        if path.startswith("/storage/v1/object/product-images/") and req.method == "POST":
            store["objects"][path.removeprefix("/storage/v1/object/product-images/")] = req.content
            return httpx.Response(200, json={"Key": path})
        if path == "/storage/v1/object/list/product-images":
            prefix = json.loads(req.content)["prefix"]
            names = sorted({k.removeprefix(prefix).split("/")[0] for k in store["objects"] if k.startswith(prefix)})
            return httpx.Response(200, json=[
                {"name": n, "id": "x" if f"{prefix}{n}" in store["objects"] else None} for n in names
            ])
        if path == "/storage/v1/object/product-images" and req.method == "DELETE":
            for k in json.loads(req.content)["prefixes"]:
                store["objects"].pop(k, None)
            return httpx.Response(200, json=[])
        return httpx.Response(404)

    drv = product_images.SupabaseStorage("https://ref.supabase.co", "sb_secret_test", "product-images", transport=httpx.MockTransport(handler))
    drv.upload("products/p1/a.png", b"png-bytes", "image/png")
    assert store["bucket"] == {"id": "product-images", "name": "product-images", "public": True,
                               "file_size_limit": product_images.MAX_BYTES, "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"]}
    method, path, headers = calls[-1]
    assert (method, path) == ("POST", "/storage/v1/object/product-images/products/p1/a.png")
    assert headers["apikey"] == "sb_secret_test" and "authorization" not in headers  # new-style keys: apikey only
    assert headers["content-type"] == "image/png" and headers["x-upsert"] == "false" and "immutable" in headers["cache-control"]
    drv.upload("products/p2/b.png", b"x", "image/png")
    assert sorted(drv.list_keys()) == ["products/p1/a.png", "products/p2/b.png"]
    drv.delete(["products/p1/a.png"])
    assert list(store["objects"]) == ["products/p2/b.png"]
    legacy = product_images.SupabaseStorage("https://ref.supabase.co", "eyJhbGciOi.legacy", "product-images", transport=httpx.MockTransport(handler))
    legacy.delete(["products/p2/b.png"])
    assert calls[-1][2]["authorization"] == "Bearer eyJhbGciOi.legacy"
