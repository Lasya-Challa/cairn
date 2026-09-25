from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AuditEvent, Student, User

ALGORITHM = "HS256"
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.token_ttl_minutes)
    payload = {"sub": str(user.id), "role": user.role, "exp": expires}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, get_settings().secret_key, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise unauthorized
    return user


def require_roles(*roles: str):
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role does not have access to this.")
        return user

    return dependency


# Roles allowed to read clinical content (notes, assessments, plans).
# Billing staff see service metadata only: minimum necessary access.
CLINICAL_ROLES = ("counselor", "admin")


def get_student_for_user(db: Session, student_id: int, user: User) -> Student:
    """Load a student and enforce record-level access.

    Admins see every student in their district. Counselors see only their caseload.
    """
    student = db.get(Student, student_id)
    if student is None or student.district_id != user.district_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found.")
    if user.role == "counselor" and student.counselor_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This student is not on your caseload.")
    if user.role not in CLINICAL_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role does not have access to student records.")
    return student


def audit(
    db: Session,
    user: User | None,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    student_id: int | None = None,
    detail: str | None = None,
) -> None:
    db.add(
        AuditEvent(
            user_id=user.id if user else None,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            student_id=student_id,
            detail=detail,
        )
    )
