from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .auth import get_current_user
from .config import get_settings
from .database import get_db
from .models import Issue, Project, TestResult, User
from .services import ai
from .services.source import issue_to_out, proposal_to_out
from .services.testing import TestingError


router = APIRouter(tags=["AI"], dependencies=[Depends(get_current_user)])


def project_access(project_id: str, db: Session, user: User) -> Project:
    project = db.get(Project, project_id)
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
    return {"aiConfigured": ai.configured(), "analysisModes": ["static", "ai"] if ai.configured() else ["static"], "sandboxImage": get_settings().sandbox_image}


@router.post("/projects/{project_id}/ai-scan")
def scan(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    project = project_access(project_id, db, user)
    issues = invoke(db, lambda: ai.scan_with_ai(db, project))
    db.commit()
    return {"projectId": project.id, "issues": [issue_to_out(issue) for issue in issues]}


@router.post("/issues/{issue_id}/ai-proposal")
def proposal(issue_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    issue = db.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy lỗi")
    project_access(issue.project_id, db, user)
    result = invoke(db, lambda: ai.generate_proposal(db, issue))
    db.commit()
    return proposal_to_out(result)


@router.post("/projects/{project_id}/test-cases/generate")
def generate_tests(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = project_access(project_id, db, user)
    result = invoke(db, lambda: ai.generate_tests(db, project))
    db.commit()
    return result


@router.post("/projects/{project_id}/test-runs/{run_id}/explain")
def explain(project_id: str, run_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = project_access(project_id, db, user)
    run = db.get(TestResult, run_id)
    if run is None or run.project_id != project.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy kết quả test")
    explanation = invoke(db, lambda: ai.explain_test_run(run))
    return {"explanation": explanation}
