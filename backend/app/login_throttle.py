"""Failed sign-in throttling per account identifier.

The per-minute request limit on /auth/login (routers/auth_router.py) is per
client IP; spread over
many IPs, password guessing against one account would never trip it. This
counts failures per identifier (the username, lower-cased) in the shared
database table auth_throttle, so it holds across IPs and server processes:

  STAFF_LOGIN_MAX_FAILURES            failures allowed within the window   (default 10)
  STAFF_LOGIN_FAILURE_WINDOW_MINUTES  the counting window                  (default 15)
  STAFF_LOGIN_BLOCK_MINUTES           how long the identifier then waits   (default 15)

Blocks always expire (no permanent lockout) and a successful sign-in
clears the count. Identifiers with no account are counted the same way,
so the throttle never reveals whether an account exists. Keys are HMACs —
usernames aren't stored in the table. The storefront has the same
mechanism for customer sign-in (ecobel-website app/login_throttle.py).
"""
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import SECRET_KEY
from .models import AuthThrottle


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, default))
    except ValueError:
        return default
    return value if value > 0 else default


MAX_FAILURES = _env_int("STAFF_LOGIN_MAX_FAILURES", 10)
WINDOW = timedelta(minutes=_env_int("STAFF_LOGIN_FAILURE_WINDOW_MINUTES", 15))
BLOCK = timedelta(minutes=_env_int("STAFF_LOGIN_BLOCK_MINUTES", 15))
TOO_MANY = "محاولات دخول كتير — استني ربع ساعة وحاولي تاني"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _key(namespace: str, identifier: str) -> str:
    return hmac.new(SECRET_KEY.encode(), f"{namespace}:{identifier}".encode(), hashlib.sha256).hexdigest()


def _row(db: Session, key: str) -> AuthThrottle | None:
    # FOR UPDATE: concurrent failures for one identifier are counted one at a time.
    return db.query(AuthThrottle).filter(AuthThrottle.key == key).with_for_update().first()


def ensure_not_blocked(db: Session, namespace: str, identifier: str) -> None:
    row = db.query(AuthThrottle).filter(AuthThrottle.key == _key(namespace, identifier)).first()
    if row and row.blocked_until and _aware(row.blocked_until) > now_utc():
        raise HTTPException(429, TOO_MANY)


def record_failure(db: Session, namespace: str, identifier: str) -> None:
    key, now = _key(namespace, identifier), now_utc()
    row = _row(db, key)
    if row is None:
        try:
            with db.begin_nested():
                db.add(AuthThrottle(key=key, failures=1, window_started_at=now))
        except IntegrityError:  # another failure created it first
            row = _row(db, key)
    if row is not None:
        if _aware(row.window_started_at) <= now - WINDOW:
            row.failures, row.window_started_at, row.blocked_until = 1, now, None
        else:
            row.failures += 1
        if row.failures >= MAX_FAILURES:
            row.blocked_until = now + BLOCK
    db.commit()


def record_success(db: Session, namespace: str, identifier: str) -> None:
    db.query(AuthThrottle).filter(AuthThrottle.key == _key(namespace, identifier)).delete()
    db.commit()
