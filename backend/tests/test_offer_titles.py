"""An offer's title is what customers see next to its price on the
storefront, so it can't be blank. Titles are saved trimmed."""
import os
import sys
import tempfile

if "app.database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
    os.environ.pop("SECRET_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, models  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.offers import TITLE_REQUIRED  # noqa: E402

client = TestClient(app)
H = {"Authorization": f"Bearer {auth.create_access_token({'sub': 'titles_staff'})}"}


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    db.add(models.User(username="titles_staff", hashed_password=auth.hash_password("x")))
    db.add(models.Category(id="tt_cat", name="فئة عناوين العروض"))
    for i in range(1, 7):
        db.add(models.Product(id=f"tt_p{i}", name=f"tt_p{i}", category_id="tt_cat", sale_price=100, quantity=5))
    db.commit()
    db.close()


def create(pid, title):
    return client.post("/offers/", json={"product_id": pid, "title": title, "offer_price": 80}, headers=H)


@pytest.mark.parametrize("pid,title", [("tt_p1", ""), ("tt_p2", "   "), ("tt_p3", "\t \n")])
def test_blank_or_whitespace_title_is_refused_in_arabic(pid, title):
    res = create(pid, title)
    assert res.status_code == 400 and res.json()["detail"] == TITLE_REQUIRED


@pytest.mark.parametrize("pid,title", [("tt_p4", "عرض العناية اليومية"), ("tt_p5", "Special Hair Care Offer")])
def test_arabic_and_english_titles_are_saved_exactly(pid, title):
    res = create(pid, f"  {title}  ")
    assert res.status_code == 201 and res.json()["title"] == title


def test_title_can_be_changed_but_not_blanked():
    o = create("tt_p6", "عرض الصيف").json()
    res = client.patch(f"/offers/{o['id']}", json={"title": "عرض الشتا"}, headers=H)
    assert res.status_code == 200 and res.json()["title"] == "عرض الشتا"
    for bad in ("", "  ", None):
        res = client.patch(f"/offers/{o['id']}", json={"title": bad}, headers=H)
        assert res.status_code == 400 and res.json()["detail"] == TITLE_REQUIRED
    assert next(x for x in client.get("/offers/", headers=H).json() if x["id"] == o["id"])["title"] == "عرض الشتا"
