from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .auth import get_current_user, require_developer
from .config import get_settings
from .database import get_db
from .models import Issue, Project, TestResult, User
from .services import ai
from .services.preview import configured as preview_configured
from .services.source import issue_to_out, proposal_to_out
from .services.testing import TestingError


router = APIRouter(tags=["AI"], dependencies=[Depends(require_developer)])


def project_access(project_id: str, db: Session, user: User) -> Project:
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.deleted_at.is_(None),
    ).first()
    if project is None or (user.role != "admin" and project.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Không tìm thấy project")
    return project


def invoke(db: Session, action):
    try:
        return action()
    except ai.AIUnavailable as error:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (ai.AIOutputError, TestingError) as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/capabilities")
def capabilities() -> dict:
    providers = ai.provider_catalog()
    default_provider = get_settings().ai_default_provider
    if not any(
        item["id"] == default_provider and item["configured"] for item in providers
    ):
        default_provider = next(
            (item["id"] for item in providers if item["configured"]), None
        )
    return {
        "aiConfigured": ai.configured(),
        "analysisModes": ["static", "ai"] if ai.configured() else ["static"],
        "aiProviders": providers,
        "defaultAiProvider": default_provider,
        "sandboxImage": get_settings().sandbox_image,
        "previewConfigured": preview_configured(),
        "previewProvider": "Daytona",
        "previewTtlMinutes": get_settings().preview_ttl_minutes,
    }


@router.post("/projects/{project_id}/ai-scan")
def scan(
    project_id: str,
    provider: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    project = project_access(project_id, db, user)
    issues = invoke(db, lambda: ai.scan_with_ai(db, project, provider))
    db.commit()
    return {"projectId": project.id, "issues": [issue_to_out(issue) for issue in issues]}


@router.post("/issues/{issue_id}/ai-proposal")
def proposal(
    issue_id: str,
    provider: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue = db.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy lỗi")
    project_access(issue.project_id, db, user)
    result = invoke(db, lambda: ai.generate_proposal(db, issue, provider))
    db.commit()
    return proposal_to_out(result)


@router.post("/projects/{project_id}/test-cases/generate")
def generate_tests(
    project_id: str,
    provider: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = project_access(project_id, db, user)
    result = invoke(db, lambda: ai.generate_tests(db, project, provider))
    db.commit()
    return result


@router.post("/projects/{project_id}/test-runs/{run_id}/explain")
def explain(
    project_id: str,
    run_id: str,
    provider: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = project_access(project_id, db, user)
    run = db.get(TestResult, run_id)
    if run is None or run.project_id != project.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy kết quả test")
    explanation = invoke(db, lambda: ai.explain_test_run(run, provider))
    return {"explanation": explanation}
