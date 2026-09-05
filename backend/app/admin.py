"""Administrative operations derived from persisted users and project records."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, literal, union_all, or_
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
    reason: str = Field(default="", max_length=500)


class EditDeveloperInput(BaseModel):
    fullName: str = Field(min_length=1, max_length=255)
    email: str = Field(min_length=1, max_length=255)

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


class ResetPasswordInput(BaseModel):
    temporaryPassword: str = Field(min_length=8, max_length=128)


def developer_or_404(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    if user.role != "developer":
        raise HTTPException(status_code=403, detail="Chỉ có thể quản lý tài khoản Developer")
    return user


def user_snapshot(user: User, **extra) -> str:
    return json.dumps({"user_id": user.id, "email": user.email, "full_name": user.full_name, **extra}, ensure_ascii=False)


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


@router.get("/projects/{project_id}")
def project_detail(project_id: str, db: Session = Depends(get_db)) -> dict:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy project")
    latest = db.query(TestResult).filter(TestResult.project_id == project_id).order_by(TestResult.created_at.desc(), TestResult.id.desc()).first()
    return {
        "id": project.id, "name": project.name, "language": project.language,
        "version": project.current_version, "createdAt": project.created_at, "updatedAt": project.updated_at,
        "ownerId": project.owner_id, "ownerName": (project.owner.full_name or project.owner.email) if project.owner else "",
        "issueCount": db.query(Issue).filter(Issue.project_id == project_id).count(),
        "latestTest": {"version": latest.version, "status": latest.status, "total": latest.total,
                       "passed": latest.passed, "failed": latest.failed, "errors": latest.errors,
                       "createdAt": latest.created_at} if latest else None,
    }


@router.get("/activities")
def activities(page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100),
               actor_id: str | None = None, action: str | None = None,
               date_from: datetime | None = None, date_to: datetime | None = None,
               db: Session = Depends(get_db)) -> dict:
    def utc_naive(value: datetime) -> datetime:
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value.tzinfo else value
    start = utc_naive(date_from) if date_from else None
    end = utc_naive(date_to) if date_to else None
    if start and end and start >= end:
        raise HTTPException(status_code=422, detail="Khoảng ngày không hợp lệ")
    # Union persisted events with legacy version/test records; filter BEFORE pagination.
    rows = union_all(
        select(AuditEvent.id.label("id"), AuditEvent.actor_id.label("actor_id"), AuditEvent.project_id.label("project_id"),
               AuditEvent.action.label("action"), AuditEvent.detail.label("detail"), AuditEvent.created_at.label("created_at")),
        select(CodeVersion.id, CodeVersion.created_by, CodeVersion.project_id, literal("VERSION_SAVED"), CodeVersion.version, CodeVersion.created_at),
        select(TestResult.id, literal(None), TestResult.project_id, literal("TEST_RUN"), TestResult.version, TestResult.created_at),
    ).subquery()
    query = select(rows)
    if actor_id:
        system_actor = or_(rows.c.actor_id.is_(None), ~rows.c.actor_id.in_(select(User.id)))
        query = query.where(system_actor if actor_id == "system" else rows.c.actor_id == actor_id)
    if action:
        query = query.where(rows.c.action == action)
    if start:
        query = query.where(rows.c.created_at >= start)
    if end:
        query = query.where(rows.c.created_at < end)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    result = db.execute(query.order_by(rows.c.created_at.desc(), rows.c.id.desc()).offset((page - 1) * page_size).limit(page_size)).mappings()
    people = {user.id: user for user in db.query(User).all()}
    projects = {project.id: project for project in db.query(Project).all()}
    items = []
    safe_keys = {"user_id", "email", "full_name", "reason", "previous_email", "previous_full_name", "issue_id", "issue_type", "file_path", "review_id"}
    for row in result:
        try:
            detail = json.loads(row["detail"])
        except (ValueError, TypeError):
            detail = {"version": row["detail"]} if row["action"] in {"VERSION_SAVED", "TEST_RUN"} else {}
        if not isinstance(detail, dict):
            detail = {}
        detail = {key: value for key, value in detail.items() if key in safe_keys or key == "version"}
        actor = people.get(row["actor_id"])
        project = projects.get(row["project_id"])
        items.append({"id": row["id"], "action": row["action"], "actorId": row["actor_id"],
                      "actorName": (actor.full_name or actor.email) if actor else "Hệ thống",
                      "projectName": project.name if project else None, "createdAt": row["created_at"], "detail": detail})
    return {"items": items, "total": total, "page": page, "pageSize": page_size,
            "actors": [{"id": user.id, "name": user.full_name or user.email} for user in people.values()],
            "actions": list(db.scalars(select(rows.c.action).distinct().order_by(rows.c.action)))}


@router.put("/users/{user_id}/profile")
def edit_developer(user_id: str, payload: EditDeveloperInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    user = developer_or_404(db, user_id)
    if db.query(User).filter(func.lower(User.email) == payload.email, User.id != user.id).first():
        raise HTTPException(status_code=409, detail="Email đã được sử dụng")
    if user.full_name == payload.fullName and user.email == payload.email:
        return admin_user_to_out(user, db)
    previous = {"previous_email": user.email, "previous_full_name": user.full_name}
    user.full_name, user.email = payload.fullName, payload.email
    record_event(db, "USER_UPDATED", actor_id=admin.id, detail=user_snapshot(user, **previous))
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email đã được sử dụng") from error
    db.refresh(user)
    return admin_user_to_out(user, db)


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: str, payload: ResetPasswordInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> dict:
    user = developer_or_404(db, user_id)
    user.password_hash = hash_password(payload.temporaryPassword)
    user.must_change_password = True
    db.query(AuthSession).filter(AuthSession.user_id == user.id).delete(synchronize_session=False)
    record_event(db, "PASSWORD_RESET", actor_id=admin.id, detail=user_snapshot(user))
    db.commit()
    db.refresh(user)
    return admin_user_to_out(user, db)


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
    user = developer_or_404(db, user_id)
    changed = user.is_active != payload.isActive
    user.is_active = payload.isActive
    if not user.is_active:
        db.query(AuthSession).filter(AuthSession.user_id == user.id).delete(synchronize_session=False)
    if changed:
        record_event(db, "USER_UNLOCKED" if user.is_active else "USER_LOCKED", actor_id=admin.id,
                     detail=user_snapshot(user, reason=payload.reason.strip()))
    db.commit()
    db.refresh(user)
    return admin_user_to_out(user, db)
