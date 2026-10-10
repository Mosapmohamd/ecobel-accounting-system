"""Staff sign-in: failures are throttled per username across IPs, blocks
expire, nothing reveals whether a username exists, and behind the hosting
proxy each staff member keeps their own per-IP rate limit (forwarded
headers are trusted only from the documented proxy ranges)."""
import os
import re
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

if "app.database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'test.db')}"
    os.environ.pop("SECRET_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware  # noqa: E402

from app import auth, login_throttle, models  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.routers.auth_router import limiter  # noqa: E402

WRONG = "اسم المستخدم أو كلمة المرور غير صحيحة"
DOC = Path(__file__).resolve().parents[2] / "docs" / "DEPLOYMENT.md"


@pytest.fixture(scope="module", autouse=True)
def seed():
    db = SessionLocal()
    for name, pw in (("sl_owner", "owner-pass-12"), ("sl_other", "other-pass-12"), ("sl_expiry", "expiry-pass-1"),
                     ("sl_legacy", "abc123"), ("sl_proxy_a", "proxy-pass-1"), ("sl_proxy_b", "proxy-pass-2")):
        db.add(models.User(username=name, hashed_password=auth.hash_password(pw)))
    db.commit()
    db.close()


@pytest.fixture(autouse=True)
def per_ip_limit(request):
    """The per-minute IP limit is off except where it's the subject."""
    limiter.reset()
    limiter.enabled = "proxy" in request.node.name
    yield
    limiter.enabled = True
    limiter.reset()


@pytest.fixture
def clock(monkeypatch):
    state = {"now": login_throttle.now_utc()}
    monkeypatch.setattr(login_throttle, "now_utc", lambda: state["now"])
    return state


def login(username, password, ip="198.51.100.10", client=None):
    c = client or TestClient(app, client=(ip, 40000))
    return c.post("/auth/login", data={"username": username, "password": password})


def test_failures_for_one_username_are_throttled_across_ips():
    for n in range(login_throttle.MAX_FAILURES):
        assert login("sl_owner", "wrong", ip=f"203.0.113.{n}").status_code == 401
    blocked = login("sl_owner", "owner-pass-12", ip="192.0.2.77")
    assert blocked.status_code == 429 and blocked.json()["detail"] == login_throttle.TOO_MANY
    assert login("sl_other", "other-pass-12").status_code == 200


def test_username_case_and_spaces_count_as_the_same_account():
    for variant in ("SL_OTHER", " sl_other ", "Sl_Other") * 3:
        login(variant, "wrong")
    assert login("sl_other", "wrong").status_code == 401  # the 10th failure (all spellings counted together)…
    assert login("sl_other", "other-pass-12").status_code == 429  # …pauses that username


def test_block_expires(clock):
    for _ in range(login_throttle.MAX_FAILURES):
        login("sl_expiry", "wrong")
    assert login("sl_expiry", "expiry-pass-1").status_code == 429
    clock["now"] += login_throttle.BLOCK + timedelta(seconds=1)
    assert login("sl_expiry", "expiry-pass-1").status_code == 200


def test_responses_never_reveal_whether_a_username_exists(monkeypatch):
    exists, missing = login("sl_legacy", "wrong"), login("sl_nobody", "wrong")
    assert exists.status_code == missing.status_code == 401
    assert exists.json() == missing.json() == {"detail": WRONG}
    checked = []
    real = auth.verify_password
    monkeypatch.setattr(auth, "verify_password", lambda p, h: checked.append(h) or real(p, h))
    login("sl_nobody_2", "x")
    assert checked == [auth._NO_ACCOUNT_HASH]


def test_existing_short_staff_passwords_still_sign_in():
    assert login("sl_legacy", "abc123").status_code == 200


def _documented_trusted_ranges() -> str:
    m = re.search(r'--forwarded-allow-ips "([^"]+)"', DOC.read_text(encoding="utf-8"))
    assert m, "start command with --forwarded-allow-ips not found in docs/DEPLOYMENT.md"
    assert m.group(1) != "*"
    return m.group(1)


def test_proxy_each_staff_member_keeps_their_own_ip_limit():
    behind_lb = TestClient(ProxyHeadersMiddleware(app, trusted_hosts=_documented_trusted_ranges()), client=("10.0.0.5", 40000))

    def via_lb(xff, user, pw):
        return behind_lb.post("/auth/login", data={"username": user, "password": pw}, headers={"X-Forwarded-For": xff})

    # Staff member A uses up their 5/minute limit (faking extra addresses doesn't help)…
    codes = [via_lb(f"6.6.6.{n}, 203.0.113.10", "sl_proxy_a", "wrong").status_code for n in range(6)]
    assert codes == [401] * 5 + [429]
    # …while staff member B, at another real address behind the same balancer, signs in fine.
    assert via_lb("203.0.113.11", "sl_proxy_b", "proxy-pass-2").status_code == 200


def test_proxy_headers_from_untrusted_clients_are_ignored():
    direct = TestClient(ProxyHeadersMiddleware(app, trusted_hosts=_documented_trusted_ranges()), client=("198.51.100.200", 40000))
    # A client that isn't the balancer can't pick a fresh address per request.
    codes = [direct.post("/auth/login", data={"username": "sl_proxy_a", "password": "wrong"},
                         headers={"X-Forwarded-For": f"203.0.113.{100 + n}"}).status_code for n in range(6)]
    assert codes == [401] * 5 + [429]
