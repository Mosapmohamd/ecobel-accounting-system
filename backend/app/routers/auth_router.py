from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from .. import auth, login_throttle, schemas
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["Auth"])
limiter = Limiter(key_func=get_remote_address)


@router.post("/login", response_model=schemas.Token)
@limiter.limit("5/minute")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Failures are also counted per username across IPs (app/login_throttle.py);
    # the same answer whether or not the username exists.
    identifier = form_data.username.strip().lower()
    login_throttle.ensure_not_blocked(db, "staff", identifier)
    user = auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        login_throttle.record_failure(db, "staff", identifier)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="اسم المستخدم أو كلمة المرور غير صحيحة",
        )
    login_throttle.record_success(db, "staff", identifier)
    access_token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}
