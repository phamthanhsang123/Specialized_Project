"""Password authentication with revocable, database-backed bearer sessions."""

from datetime import datetime, timedelta
import hashlib
import hmac
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import AuthSession, User
from .audit import record_event


PASSWORD_ITERATIONS = 600_000
bearer = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/auth", tags=["Authentication"])


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        algorithm, iterations, salt, expected = stored_hash.split("$")
        rounds = int(iterations)
        if algorithm != "pbkdf2_sha256" or not 100_000 <= rounds <= 2_000_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), rounds).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# Missing accounts still perform a password derivation to avoid a fast lookup oracle.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


def normalize_email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 255 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise ValueError("Email không hợp lệ")
    return value


class LoginInput(BaseModel):
    email: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_email(value)


def user_to_out(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "fullName": user.full_name or user.email,
        "role": user.role,
        "isActive": user.is_active,
        "mustChangePassword": user.must_change_password,
    }


def unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn", headers={"WWW-Authenticate": "Bearer"})


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_current_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> AuthSession:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized()
    session = db.query(AuthSession).filter(AuthSession.token_hash == token_hash(credentials.credentials)).first()
    if session is None or session.expires_at <= datetime.utcnow():
        raise unauthorized()
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise unauthorized()
    return session


def get_authenticated_user(session: AuthSession = Depends(get_current_session), db: Session = Depends(get_db)) -> User:
    user = db.get(User, session.user_id)
    if user is None:
        raise unauthorized()
    return user


def get_current_user(user: User = Depends(get_authenticated_user)) -> User:
    if user.must_change_password:
        raise HTTPException(status_code=403, detail="Bạn cần đổi mật khẩu trước khi tiếp tục")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Chức năng chỉ dành cho Admin")
    return user


def require_developer(user: User = Depends(get_current_user)) -> User:
    if user.role != "developer":
        raise HTTPException(status_code=403, detail="Thao tác mã nguồn chỉ dành cho Developer")
    return user


@router.post("/login")
def login(payload: LoginInput, db: Session = Depends(get_db)) -> dict:
    user = db.query(User).filter(func.lower(User.email) == payload.email).first()
    valid_password = verify_password(payload.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not valid_password or not user.is_active:
        raise HTTPException(status_code=401, detail="Email hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa", headers={"WWW-Authenticate": "Bearer"})
    token = secrets.token_urlsafe(48)
    db.query(AuthSession).filter(AuthSession.expires_at <= datetime.utcnow()).delete(synchronize_session=False)
    db.add(AuthSession(user_id=user.id, token_hash=token_hash(token), expires_at=datetime.utcnow() + timedelta(hours=get_settings().auth_session_hours)))
    db.commit()
    return {"token": token, "user": user_to_out(user)}


@router.get("/me")
def me(user: User = Depends(get_authenticated_user)) -> dict:
    return user_to_out(user)


class ChangePasswordInput(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=1024)
    newPassword: str = Field(min_length=8, max_length=128)


@router.post("/change-password")
def change_password(payload: ChangePasswordInput, user: User = Depends(get_authenticated_user), db: Session = Depends(get_db)) -> dict:
    if not verify_password(payload.currentPassword, user.password_hash):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng")
    if payload.currentPassword == payload.newPassword:
        raise HTTPException(status_code=400, detail="Mật khẩu mới phải khác mật khẩu hiện tại")
    user.password_hash = hash_password(payload.newPassword)
    user.must_change_password = False
    db.query(AuthSession).filter(AuthSession.user_id == user.id).delete(synchronize_session=False)
    record_event(db, "PASSWORD_CHANGED", actor_id=user.id)
    # Require a new login: no replacement token can be lost on an uncertain response.
    db.commit()
    return {"message": "Đã đổi mật khẩu. Vui lòng đăng nhập lại."}


@router.post("/logout")
def logout(session: AuthSession = Depends(get_current_session), db: Session = Depends(get_db)) -> dict:
    db.delete(session)
    db.commit()
    return {"message": "Đã đăng xuất"}


def bootstrap_admin(db: Session, email: str | None, password: str | None) -> None:
    """Create a first administrator only when explicitly configured."""
    if not email and not password:
        return
    if not email or not password or not 8 <= len(password) <= 1024:
        raise ValueError("Cấu hình BOOTSTRAP_ADMIN_EMAIL và BOOTSTRAP_ADMIN_PASSWORD (tối thiểu 8 ký tự)")
    email = normalize_email(email)
    if db.query(User).filter(User.role == "admin").first():
        return
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise ValueError("Email bootstrap đã thuộc một tài khoản khác")
    db.add(User(email=email, full_name="System Admin", password_hash=hash_password(password), role="admin", is_active=True))
    db.flush()
