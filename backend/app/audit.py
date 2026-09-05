"""Durable audit events stored in the same transaction as the recorded change."""

from sqlalchemy.orm import Session

from .models import AuditEvent


def record_event(db: Session, action: str, actor_id: str | None = None,
                 project_id: str | None = None, detail: str = "") -> AuditEvent:
    event = AuditEvent(action=action, actor_id=actor_id, project_id=project_id, detail=detail)
    db.add(event)
    return event
