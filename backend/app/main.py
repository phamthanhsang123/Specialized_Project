from collections.abc import Callable

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, joinedload

from .config import get_settings
from .database import Base, engine, get_db
from .models import CodeVersion, FixProposal, Issue, Project, SourceFile, TestResult
from .schemas import (
    FileContentOut,
    FileOut,
    FixProposalOut,
    IssueOut,
    MessageOut,
    ProjectCreate,
    ProjectOut,
    ScanOut,
    TestRunOut,
    UploadOut,
    VersionOut,
)
from .services.source import (
    apply_accepted_fixes,
    create_fake_test_run,
    create_snapshot,
    extract_python_files,
    file_to_out,
    issue_to_out,
    project_to_out,
    proposal_to_out,
    replace_project_files,
    review_issue,
    rollback_project,
    scan_project,
    test_to_out,
    version_to_out,
)


settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


DEMO_FILES = {
    "app/auth/login.py": """import sqlite3
from fastapi import HTTPException

def authenticate(username: str, password: str):
    connection = sqlite3.connect("users.db")
    cursor = connection.cursor()

    query = "SELECT * FROM users WHERE username = '" + username + "'"
    user = cursor.execute(query).fetchone()

    if user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {"id": user[0], "username": user[1]}
""",
    "app/services/payment.py": """API_KEY = "sk_live_demo"

def calculate_discount(total, percentage):
    return total / percentage

def charge_card(amount, token):
    try:
        return gateway.charge(amount, token)
    except:
        return None
""",
    "app/main.py": """from fastapi import FastAPI
from app.auth.login import authenticate

app = FastAPI(title="ShopSafe API")

@app.get("/health")
def health_check():
    return {"status": "healthy"}
""",
}


def ensure_schema_and_seed() -> None:
    Base.metadata.create_all(bind=engine)
    if not settings.seed_demo_data:
        return
    db = next(get_db())
    try:
        project = db.get(Project, "prj_001")
        if project is not None:
            return
        project = Project(id="prj_001", name="ShopSafe API", language="Python 3.12", current_version="v1")
        db.add(project)
        db.flush()
        for path, content in DEMO_FILES.items():
            db.add(SourceFile(project_id=project.id, path=path, content=content, size_bytes=len(content.encode("utf-8"))))
        db.flush()
        create_snapshot(db, project, created_by="seed")
        scan_project(db, project)
        db.commit()
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    ensure_schema_and_seed()


def get_project(project_id: str, db: Session) -> Project:
    project = db.query(Project).options(joinedload(Project.files), joinedload(Project.issues)).filter(Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_issue(issue_id: str, db: Session) -> Issue:
    issue = db.query(Issue).options(joinedload(Issue.file), joinedload(Issue.proposal)).filter(Issue.id == issue_id).first()
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def register_routes(route_app: FastAPI, prefix: str = "") -> None:
    def path(value: str) -> str:
        return f"{prefix}{value}"

    def add(method: Callable, route: str, **kwargs) -> Callable:
        return method(path(route), **kwargs)

    @add(route_app.get, "/health")
    def health() -> dict[str, str]:
        return {"status": "healthy"}

    @add(route_app.get, "/projects", response_model=list[ProjectOut])
    def list_projects(db: Session = Depends(get_db)) -> list[ProjectOut]:
        projects = db.query(Project).order_by(Project.updated_at.desc()).all()
        return [project_to_out(project) for project in projects]

    @add(route_app.post, "/projects", response_model=ProjectOut)
    def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> ProjectOut:
        project = Project(name=payload.name, language=payload.language, current_version="v1")
        db.add(project)
        db.commit()
        db.refresh(project)
        return project_to_out(project)

    @add(route_app.get, "/projects/{project_id}", response_model=ProjectOut)
    def get_project_detail(project_id: str, db: Session = Depends(get_db)) -> ProjectOut:
        return project_to_out(get_project(project_id, db))

    @add(route_app.post, "/projects/{project_id}/upload", response_model=UploadOut)
    async def upload_project(project_id: str, upload: UploadFile = File(...), db: Session = Depends(get_db)) -> UploadOut:
        project = get_project(project_id, db)
        data = await upload.read()
        try:
            files = extract_python_files(upload.filename or "upload.py", data)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not files:
            raise HTTPException(status_code=400, detail="Upload does not contain Python files")
        created = replace_project_files(db, project, files)
        db.commit()
        for item in created:
            db.refresh(item)
        return UploadOut(projectId=project.id, files=[file_to_out(item) for item in created], version=project.current_version)

    @add(route_app.get, "/projects/{project_id}/files", response_model=list[FileOut])
    def list_files(project_id: str, db: Session = Depends(get_db)) -> list[FileOut]:
        project = get_project(project_id, db)
        return [file_to_out(file) for file in sorted(project.files, key=lambda item: item.path)]

    @add(route_app.get, "/projects/{project_id}/files/content", response_model=FileContentOut)
    def get_file_content(project_id: str, path_value: str = Query(alias="path"), db: Session = Depends(get_db)) -> FileContentOut:
        source_file = db.query(SourceFile).filter(SourceFile.project_id == project_id, SourceFile.path == path_value).first()
        if source_file is None:
            raise HTTPException(status_code=404, detail="File not found")
        return FileContentOut(path=source_file.path, content=source_file.content)

    @add(route_app.post, "/projects/{project_id}/scan", response_model=ScanOut)
    def scan(project_id: str, db: Session = Depends(get_db)) -> ScanOut:
        project = get_project(project_id, db)
        issues = scan_project(db, project)
        db.commit()
        issues = db.query(Issue).options(joinedload(Issue.file)).filter(Issue.project_id == project.id).order_by(Issue.id).all()
        return ScanOut(projectId=project.id, issues=[issue_to_out(issue) for issue in issues])

    @add(route_app.get, "/projects/{project_id}/issues", response_model=list[IssueOut])
    def list_issues(project_id: str, db: Session = Depends(get_db)) -> list[IssueOut]:
        issues = db.query(Issue).options(joinedload(Issue.file)).filter(Issue.project_id == project_id).order_by(Issue.id).all()
        return [issue_to_out(issue) for issue in issues]

    @add(route_app.get, "/issues/{issue_id}")
    def get_issue_detail(issue_id: str, db: Session = Depends(get_db)) -> dict:
        issue = get_issue(issue_id, db)
        return {"issue": issue_to_out(issue), "proposal": proposal_to_out(issue.proposal) if issue.proposal else None}

    @add(route_app.get, "/issues/{issue_id}/proposal", response_model=FixProposalOut)
    def get_proposal(issue_id: str, db: Session = Depends(get_db)) -> FixProposalOut:
        proposal = db.query(FixProposal).filter(FixProposal.issue_id == issue_id).first()
        if proposal is None:
            raise HTTPException(status_code=404, detail="Proposal not found")
        return proposal_to_out(proposal)

    @add(route_app.post, "/issues/{issue_id}/accept")
    def accept_issue(issue_id: str, db: Session = Depends(get_db)) -> dict:
        issue = review_issue(db, get_issue(issue_id, db), "ACCEPTED")
        db.commit()
        db.refresh(issue)
        return {"issue": issue_to_out(issue)}

    @add(route_app.post, "/issues/{issue_id}/reject")
    def reject_issue(issue_id: str, db: Session = Depends(get_db)) -> dict:
        issue = review_issue(db, get_issue(issue_id, db), "REJECTED")
        db.commit()
        db.refresh(issue)
        return {"issue": issue_to_out(issue)}

    @add(route_app.post, "/projects/{project_id}/apply", response_model=MessageOut)
    def apply_project(project_id: str, db: Session = Depends(get_db)) -> MessageOut:
        project = get_project(project_id, db)
        count = apply_accepted_fixes(db, project)
        db.commit()
        return MessageOut(message=f"Applied {count} accepted fix proposals")

    @add(route_app.post, "/projects/{project_id}/test", response_model=TestRunOut)
    def run_tests(project_id: str, db: Session = Depends(get_db)) -> TestRunOut:
        project = get_project(project_id, db)
        run = create_fake_test_run(db, project)
        db.commit()
        db.refresh(run)
        return test_to_out(run)

    @add(route_app.get, "/projects/{project_id}/test-runs", response_model=list[TestRunOut])
    @add(route_app.get, "/projects/{project_id}/test-results", response_model=list[TestRunOut])
    def list_test_runs(project_id: str, db: Session = Depends(get_db)) -> list[TestRunOut]:
        runs = db.query(TestResult).filter(TestResult.project_id == project_id).order_by(TestResult.created_at.desc()).all()
        return [test_to_out(run) for run in runs]

    @add(route_app.get, "/projects/{project_id}/versions", response_model=list[VersionOut])
    def list_versions(project_id: str, db: Session = Depends(get_db)) -> list[VersionOut]:
        versions = db.query(CodeVersion).filter(CodeVersion.project_id == project_id).order_by(CodeVersion.created_at.desc()).all()
        return [version_to_out(version) for version in versions]

    @add(route_app.post, "/projects/{project_id}/rollback", response_model=VersionOut)
    def rollback(project_id: str, version: str | None = None, db: Session = Depends(get_db)) -> VersionOut:
        project = get_project(project_id, db)
        try:
            target = rollback_project(db, project, version)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        db.commit()
        return version_to_out(target)


register_routes(app)
register_routes(app, settings.api_prefix)
