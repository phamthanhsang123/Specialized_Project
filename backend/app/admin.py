"""Administrative operations derived from persisted users and project records."""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .auth import hash_password, normalize_email, require_admin, user_to_out
from .audit import record_event
from .database import get_db
from .models import AuditEvent, AuthSession, CodeVersion, Issue, Project, TestResult, User


router = APIRouter(prefix="/admin", tags=["Administration"], dependencies=[Depends(require_admin)])


class CreateDeveloperInput(BaseModel):
    fullName: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=1024)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("fullName")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Họ tên không được để trống")
        return value.strip()


class UpdateDeveloperInput(BaseModel):
    isActive: bool


def admin_user_to_out(user: User, db: Session) -> dict:
    return {
        **user_to_out(user),
        "createdAt": user.created_at,
        "updatedAt": user.updated_at,
        "projectCount": db.query(Project).filter(Project.owner_id == user.id).count(),
        "issueCount": db.query(Issue).join(Project).filter(Project.owner_id == user.id).count(),
    }


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    users = db.query(User).filter(User.role == "developer").order_by(User.created_at.desc()).all()
    projects = db.query(Project).options(joinedload(Project.owner)).order_by(Project.updated_at.desc()).all()
    issue_counts = dict(db.query(Issue.project_id, func.count(Issue.id)).group_by(Issue.project_id).all())
    project_by_id = {project.id: project for project in projects}
    people = {user.id: user for user in db.query(User).all()}
    activities = []

    def append_activity(identifier: str, action: str, project: Project | None, created_at, actor_id: str | None = None, detail: str = "") -> None:
        actor = people.get(actor_id) if actor_id else None
        activities.append({
            "id": identifier,
            "action": action,
            "actorName": (actor.full_name or actor.email) if actor else "Hệ thống",
            "projectName": project.name if project else "",
            "createdAt": created_at,
            "detail": detail,
        })

    events = db.query(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(20).all()
    action_names = {"ACCEPTED": "Chấp nhận đề xuất sửa", "REJECTED": "Từ chối đề xuất sửa",
                    "USER_CREATED": "Tạo tài khoản Developer", "USER_LOCKED": "Khóa tài khoản Developer",
                    "USER_UNLOCKED": "Mở khóa tài khoản Developer"}
    for event in events:
        append_activity(event.id, action_names.get(event.action, event.action), project_by_id.get(event.project_id),
                        event.created_at, event.actor_id, event.detail)
    for version in db.query(CodeVersion).order_by(CodeVersion.created_at.desc()).limit(20).all():
        append_activity(version.id, f"Lưu phiên bản {version.version}", project_by_id.get(version.project_id), version.created_at, version.created_by)
    for run in db.query(TestResult).order_by(TestResult.created_at.desc()).limit(20).all():
        append_activity(run.id, f"Chạy kiểm thử {run.version}: {run.status}", project_by_id.get(run.project_id), run.created_at)
    activities.sort(key=lambda activity: activity["createdAt"], reverse=True)
    return {
        "users": [admin_user_to_out(user, db) for user in users],
        "projects": [{
            "id": project.id,
            "name": project.name,
            "language": project.language,
            "version": project.current_version,
            "updatedAt": project.updated_at,
            "ownerId": project.owner_id,
            "ownerName": (project.owner.full_name or project.owner.email) if project.owner else "Chưa gán chủ sở hữu",
            "issueCount": issue_counts.get(project.id, 0),
        } for project in projects],
        "activities": activities[:20],
        "metrics": {
            "users": len(users),
            "activeUsers": sum(user.is_active for user in users),
            "projects": len(projects),
            "issues": sum(issue_counts.values()),
            "verifiedIssues": db.query(Issue).filter(Issue.status == "VERIFIED").count(),
            "testRuns": db.query(TestResult).count(),
            # These require a labelled evaluation set; persisted issue counts are not accuracy.
            "precision": None,
            "recall": None,
            "fixSuccessRate": None,
        },
    }


@router.post("/users", status_code=201)
def create_developer(payload: CreateDeveloperInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    if db.query(User).filter(func.lower(User.email) == payload.email).first():
        raise HTTPException(status_code=409, detail="Email đã được sử dụng")
    user = User(email=payload.email, full_name=payload.fullName, password_hash=hash_password(payload.password), role="developer", is_active=True)
    db.add(user)
    try:
        db.flush()
        record_event(db, "USER_CREATED", actor_id=admin.id,
                     detail=json.dumps({"user_id": user.id, "email": user.email, "full_name": user.full_name}, ensure_ascii=False))
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email đã được sử dụng") from error
    db.refresh(user)
    return admin_user_to_out(user, db)


@router.patch("/users/{user_id}")
def update_developer(user_id: str, payload: UpdateDeveloperInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    if user.role != "developer":
        raise HTTPException(status_code=403, detail="Chỉ có thể khóa hoặc mở khóa tài khoản Developer")
    changed = user.is_active != payload.isActive
    user.is_active = payload.isActive
    if not user.is_active:
        db.query(AuthSession).filter(AuthSession.user_id == user.id).delete(synchronize_session=False)
    if changed:
        record_event(db, "USER_UNLOCKED" if user.is_active else "USER_LOCKED", actor_id=admin.id,
                     detail=json.dumps({"user_id": user.id, "email": user.email, "full_name": user.full_name}, ensure_ascii=False))
    db.commit()
    db.refresh(user)
    return admin_user_to_out(user, db)
