import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models
from .database import get_db, DATABASE_URL

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    if DATABASE_URL.startswith("sqlite"):
        # Local SQLite (development/tests) only: a random key per process.
        # Never a fixed string in source — anyone can read that, so it
        # could be used to sign valid tokens. Sessions end on restart.
        SECRET_KEY = secrets.token_urlsafe(32)
    else:
        # Any non-SQLite DATABASE_URL means a real (likely production)
        # database is configured — refuse to start rather than silently
        # sign tokens with a secret an attacker could read from the
        # public source code.
        raise RuntimeError(
            "SECRET_KEY environment variable must be set when DATABASE_URL "
            "points at a real database. Refusing to start with no secret "
            "configured — set SECRET_KEY in your environment/.env."
        )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24h — single internal team, no need for short sessions

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# Checked when there's no such user, so a miss takes as long as a wrong
# password — response time doesn't reveal which usernames exist.
_NO_ACCOUNT_HASH = pwd_context.hash("no-such-account")


def authenticate_user(db: Session, username: str, password: str) -> Optional[models.User]:
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        verify_password(password, _NO_ACCOUNT_HASH)
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="بيانات الدخول غير صحيحة أو الجلسة منتهية",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        raise credentials_exception
    return user
