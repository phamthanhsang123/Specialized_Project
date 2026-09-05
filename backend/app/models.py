import json
from datetime import datetime
from typing import Optional
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("usr"))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="developer", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"), nullable=False)

    projects: Mapped[list["Project"]] = relationship(back_populates="owner")
    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class AuthSession(Base, TimestampMixin):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("ses"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True, nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("prj"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    language: Mapped[str] = mapped_column(String(80), default="Python 3.12", nullable=False)
    current_version: Mapped[str] = mapped_column(String(32), default="v1", nullable=False)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))

    owner: Mapped[User | None] = relationship(back_populates="projects")
    files: Mapped[list["SourceFile"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    versions: Mapped[list["CodeVersion"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    issues: Mapped[list["Issue"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    test_results: Mapped[list["TestResult"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class SourceFile(Base, TimestampMixin):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("fil"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True, nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    project: Mapped[Project] = relationship(back_populates="files")
    issues: Mapped[list["Issue"]] = relationship(back_populates="file", cascade="all, delete-orphan")


class CodeVersion(Base, TimestampMixin):
    __tablename__ = "code_versions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("ver"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True, nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    source_path: Mapped[str] = mapped_column(String(512), nullable=False)
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(64))

    project: Mapped[Project] = relationship(back_populates="versions")


class Issue(Base, TimestampMixin):
    __tablename__ = "issues"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True, nullable=False)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id"), index=True, nullable=False)
    issue_type: Mapped[str] = mapped_column(String(120), nullable=False)
    rule_code: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    impact: Mapped[str] = mapped_column(Text, nullable=False)
    line_start: Mapped[int] = mapped_column(Integer, nullable=False)
    line_end: Mapped[int] = mapped_column(Integer, nullable=False)
    # Zero means uncalibrated; public responses expose it as null, never a made-up score.
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", nullable=False)

    project: Mapped[Project] = relationship(back_populates="issues")
    file: Mapped[SourceFile] = relationship(back_populates="issues")
    proposal: Mapped[Optional["FixProposal"]] = relationship(back_populates="issue", cascade="all, delete-orphan")
    history: Mapped[list["ReviewHistory"]] = relationship(back_populates="issue", cascade="all, delete-orphan")


class FixProposal(Base, TimestampMixin):
    __tablename__ = "fix_proposals"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("fix"))
    issue_id: Mapped[str] = mapped_column(ForeignKey("issues.id"), unique=True, index=True, nullable=False)
    original_code: Mapped[str] = mapped_column(Text, nullable=False)
    replacement_code: Mapped[str] = mapped_column(Text, nullable=False)
    diff: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="PENDING", nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)
    base_source_hash: Mapped[str | None] = mapped_column(String(64))

    issue: Mapped[Issue] = relationship(back_populates="proposal")


class TestCase(Base, TimestampMixin):
    __tablename__ = "test_cases"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("tc"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    input_data: Mapped[str | None] = mapped_column(Text)
    expected_output: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE", nullable=False)


class TestResult(Base, TimestampMixin):
    __tablename__ = "test_results"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("run"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True, nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    passed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    errors: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration: Mapped[str] = mapped_column(String(40), default="0.00s", nullable=False)
    output: Mapped[str | None] = mapped_column(Text)

    project: Mapped[Project] = relationship(back_populates="test_results")


class ReviewHistory(Base, TimestampMixin):
    __tablename__ = "review_history"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("rev"))
    issue_id: Mapped[str] = mapped_column(ForeignKey("issues.id"), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    reviewer_id: Mapped[str | None] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text)

    issue: Mapped[Issue] = relationship(back_populates="history")


class AuditEvent(Base):
    """Independent activity snapshots survive source and account lifecycle changes."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: new_id("evt"))
    actor_id: Mapped[str | None] = mapped_column(String(64), index=True)
    project_id: Mapped[str | None] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True, nullable=False)


def ensure_schema_compatibility(engine: Engine) -> None:
    """Apply additive changes to databases created before authentication and patch checks.

    Call after Base.metadata.create_all(). Existing users stay active and legacy
    proposals remain readable. No table or user data is replaced.
    """
    additions = {
        "users": {"is_active": "BOOLEAN NOT NULL DEFAULT TRUE", "must_change_password": "BOOLEAN NOT NULL DEFAULT FALSE"},
        "fix_proposals": {"base_source_hash": "VARCHAR(64)"},
    }
    with engine.begin() as connection:
        inspector = inspect(connection)
        for table_name, columns in additions.items():
            if not inspector.has_table(table_name):
                continue
            existing = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, definition in columns.items():
                if column_name not in existing:
                    connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))
        # Preserve reviews created before the durable audit table was introduced.
        # Deterministic IDs make this backfill safe to repeat at every startup.
        if all(inspector.has_table(name) for name in ("audit_events", "review_history", "issues", "files")):
            recorded_review_ids = set()
            event_ids = set()
            for event_id, detail in connection.execute(select(AuditEvent.id, AuditEvent.detail)):
                event_ids.add(event_id)
                try:
                    snapshot = json.loads(detail)
                except (ValueError, TypeError):
                    continue
                if isinstance(snapshot, dict):
                    recorded_review_ids.add(snapshot.get("review_id"))
            reviews = connection.execute(select(
                ReviewHistory.id, ReviewHistory.issue_id, ReviewHistory.action,
                ReviewHistory.reviewer_id, ReviewHistory.created_at,
                Issue.project_id, Issue.issue_type, SourceFile.path,
            ).join(Issue, ReviewHistory.issue_id == Issue.id).join(SourceFile, Issue.file_id == SourceFile.id)).mappings()
            for review in reviews:
                event_id = f"evt_{uuid5(NAMESPACE_URL, 'sentinel:review:' + review['id']).hex}"
                if event_id not in event_ids and review["id"] not in recorded_review_ids:
                    connection.execute(AuditEvent.__table__.insert().values(
                        id=event_id, actor_id=review["reviewer_id"], project_id=review["project_id"],
                        action=review["action"], created_at=review["created_at"],
                        detail=json.dumps({"issue_id": review["issue_id"], "type": review["issue_type"],
                                           "file_path": review["path"], "review_id": review["id"]}, ensure_ascii=False),
                    ))
