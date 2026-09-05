from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from .admin import router as admin_router
from .ai_routes import router as ai_router
from .auth import bootstrap_admin, get_current_user, hash_password, router as auth_router
from .config import get_settings
from .database import Base, SessionLocal, engine, get_db
from .models import CodeVersion, Issue, Project, SourceFile, TestResult, User, ensure_schema_compatibility
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
    MAX_PYTHON_FILES,
    MAX_UPLOAD_BYTES,
    apply_accepted_fixes,
    create_snapshot,
    extract_python_uploads,
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
from .services.testing import SandboxUnavailable, TestingError, list_test_cases, run_project_tests, save_test_case
from .upload_limit import UploadBodyLimitMiddleware


settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_schema_and_seed()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(UploadBodyLimitMiddleware, api_prefix=settings.api_prefix)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials="*" not in settings.cors_origin_list,
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
    ensure_schema_compatibility(engine)
    with SessionLocal() as db:
        bootstrap_admin(db, settings.bootstrap_admin_email, settings.bootstrap_admin_password)
        if not settings.seed_demo_data:
            db.commit()
            return
        for email, name, role in (
            ("admin@sentinel.local", "System Admin", "admin"),
            ("developer@sentinel.local", "Demo Developer", "developer"),
        ):
            if not db.query(User).filter(User.email == email).first():
                db.add(User(email=email, full_name=name, role=role, password_hash=hash_password("password"), is_active=True))
        db.flush()
        developer = db.query(User).filter(User.email == "developer@sentinel.local").one()
        project = db.get(Project, "prj_001")
        if project is not None:
            if project.owner_id is None:
                project.owner_id = developer.id
            db.commit()
            return
        project = Project(id="prj_001", name="ShopSafe API", language="Python 3.12", current_version="v1", owner_id=developer.id)
        db.add(project)
        db.flush()
        for path, content in DEMO_FILES.items():
            db.add(SourceFile(project_id=project.id, path=path, content=content, size_bytes=len(content.encode("utf-8"))))
        db.flush()
        create_snapshot(db, project, created_by="seed")
        scan_project(db, project)
        db.commit()


def get_project(project_id: str, db: Session, user: User) -> Project:
    project = db.query(Project).options(joinedload(Project.files), joinedload(Project.issues)).filter(Project.id == project_id).first()
    if project is None or (user.role != "admin" and project.owner_id != user.id):
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_issue(issue_id: str, db: Session, user: User) -> Issue:
    issue = db.query(Issue).options(joinedload(Issue.file), joinedload(Issue.proposal)).filter(Issue.id == issue_id).first()
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    get_project(issue.project_id, db, user)
    return issue


def authorized_project(project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Project:
    return get_project(project_id, db, user)


def authorized_issue(issue_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Issue:
    return get_issue(issue_id, db, user)


class TestCaseInput(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=200_000)


def register_routes(route_app: FastAPI, prefix: str = "") -> None:
    def path(value: str) -> str:
        return f"{prefix}{value}"

    def add(method: Callable, route: str, **kwargs) -> Callable:
        return method(path(route), **kwargs)

    @add(route_app.get, "/health")
    def health() -> dict[str, str]:
        return {"status": "healthy"}

    @add(route_app.get, "/projects", response_model=list[ProjectOut])
    def list_projects(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[ProjectOut]:
        query = db.query(Project)
        if user.role != "admin":
            query = query.filter(Project.owner_id == user.id)
        projects = query.order_by(Project.updated_at.desc()).all()
        return [project_to_out(project) for project in projects]

    @add(route_app.post, "/projects", response_model=ProjectOut)
    def create_project(payload: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ProjectOut:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Tên project không được để trống")
        project = Project(name=name, language=payload.language, current_version="v1", owner_id=user.id)
        db.add(project)
        db.commit()
        db.refresh(project)
        return project_to_out(project)

    @add(route_app.get, "/projects/{project_id}", response_model=ProjectOut)
    def get_project_detail(project: Project = Depends(authorized_project)) -> ProjectOut:
        return project_to_out(project)

    @add(route_app.post, "/projects/{project_id}/upload", response_model=UploadOut)
    async def upload_project(
        project: Project = Depends(authorized_project),
        file: list[UploadFile] | None = File(None),
        upload: UploadFile | None = File(None),
        db: Session = Depends(get_db),
    ) -> UploadOut:
        selected = list(file or [])
        if upload is not None:
            selected.append(upload)
        if not selected:
            raise HTTPException(status_code=400, detail="Vui lòng chọn file Python hoặc ZIP")
        if len(selected) > MAX_PYTHON_FILES:
            raise HTTPException(status_code=400, detail="Upload exceeds 500 Python files")

        uploaded: list[tuple[str, bytes]] = []
        total_bytes = 0
        for item in selected:
            data = await item.read(MAX_UPLOAD_BYTES - total_bytes + 1)
            total_bytes += len(data)
            if total_bytes > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Tổng file upload không được vượt quá 10 MB")
            uploaded.append((item.filename or "upload.py", data))
        try:
            files = extract_python_uploads(uploaded)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not files:
            raise HTTPException(status_code=400, detail="Upload does not contain Python files")
        try:
            created = replace_project_files(db, project, files)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        db.commit()
        for item in created:
            db.refresh(item)
        return UploadOut(projectId=project.id, files=[file_to_out(item) for item in created], version=project.current_version)

    @add(route_app.get, "/projects/{project_id}/files", response_model=list[FileOut])
    def list_files(project: Project = Depends(authorized_project)) -> list[FileOut]:
        return [file_to_out(file) for file in sorted(project.files, key=lambda item: item.path)]

    @add(route_app.get, "/projects/{project_id}/files/content", response_model=FileContentOut)
    def get_file_content(path_value: str = Query(alias="path"), project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> FileContentOut:
        source_file = db.query(SourceFile).filter(SourceFile.project_id == project.id, SourceFile.path == path_value).first()
        if source_file is None:
            raise HTTPException(status_code=404, detail="File not found")
        return FileContentOut(path=source_file.path, content=source_file.content)

    @add(route_app.post, "/projects/{project_id}/scan", response_model=ScanOut)
    def scan(project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> ScanOut:
        issues = scan_project(db, project)
        db.commit()
        issues = db.query(Issue).options(joinedload(Issue.file)).filter(Issue.project_id == project.id).order_by(Issue.id).all()
        return ScanOut(projectId=project.id, issues=[issue_to_out(issue) for issue in issues])

    @add(route_app.get, "/projects/{project_id}/issues", response_model=list[IssueOut])
    def list_issues(project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> list[IssueOut]:
        issues = db.query(Issue).options(joinedload(Issue.file)).filter(Issue.project_id == project.id).order_by(Issue.id).all()
        return [issue_to_out(issue) for issue in issues]

    @add(route_app.get, "/issues/{issue_id}")
    def get_issue_detail(issue: Issue = Depends(authorized_issue)) -> dict:
        return {"issue": issue_to_out(issue), "proposal": proposal_to_out(issue.proposal) if issue.proposal else None}

    @add(route_app.get, "/issues/{issue_id}/proposal", response_model=FixProposalOut)
    def get_proposal(issue: Issue = Depends(authorized_issue)) -> FixProposalOut:
        proposal = issue.proposal
        if proposal is None:
            raise HTTPException(status_code=404, detail="Proposal not found")
        if not proposal.base_source_hash:
            raise HTTPException(status_code=409, detail="Đề xuất từ bản cũ chưa được kiểm tra. Hãy quét source để tạo lại.")
        return proposal_to_out(proposal)

    @add(route_app.post, "/issues/{issue_id}/accept")
    def accept_issue(issue: Issue = Depends(authorized_issue), db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
        try:
            issue = review_issue(db, issue, "ACCEPTED", reviewer_id=user.id)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        db.commit()
        db.refresh(issue)
        return {"issue": issue_to_out(issue)}

    @add(route_app.post, "/issues/{issue_id}/reject")
    def reject_issue(issue: Issue = Depends(authorized_issue), db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
        try:
            issue = review_issue(db, issue, "REJECTED", reviewer_id=user.id)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        db.commit()
        db.refresh(issue)
        return {"issue": issue_to_out(issue)}

    @add(route_app.post, "/projects/{project_id}/apply", response_model=MessageOut)
    def apply_project(project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> MessageOut:
        try:
            count = apply_accepted_fixes(db, project)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        db.commit()
        return MessageOut(message=f"Applied {count} accepted fix proposals")

    @add(route_app.post, "/projects/{project_id}/test", response_model=TestRunOut)
    def run_tests(project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> TestRunOut:
        try:
            run = run_project_tests(db, project)
        except SandboxUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except TestingError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        db.commit()
        db.refresh(run)
        return test_to_out(run)

    @add(route_app.get, "/projects/{project_id}/test-runs", response_model=list[TestRunOut])
    @add(route_app.get, "/projects/{project_id}/test-results", response_model=list[TestRunOut])
    def list_test_runs(project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> list[TestRunOut]:
        runs = db.query(TestResult).filter(TestResult.project_id == project.id).order_by(TestResult.created_at.desc()).all()
        return [test_to_out(run) for run in runs]

    @add(route_app.get, "/projects/{project_id}/test-cases")
    def get_test_cases(project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> list[dict]:
        return list_test_cases(db, project)

    @add(route_app.post, "/projects/{project_id}/test-cases", status_code=201)
    def create_test_case(payload: TestCaseInput, project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> dict:
        try:
            case = save_test_case(db, project, payload.name, payload.code)
        except TestingError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        db.commit()
        return case

    @add(route_app.get, "/projects/{project_id}/versions", response_model=list[VersionOut])
    def list_versions(project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> list[VersionOut]:
        versions = db.query(CodeVersion).filter(CodeVersion.project_id == project.id).order_by(CodeVersion.created_at.desc()).all()
        return [version_to_out(version) for version in versions]

    @add(route_app.post, "/projects/{project_id}/rollback", response_model=VersionOut)
    def rollback(version: str | None = None, project: Project = Depends(authorized_project), db: Session = Depends(get_db)) -> VersionOut:
        try:
            target = rollback_project(db, project, version)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        db.commit()
        return version_to_out(target)


register_routes(app)
register_routes(app, settings.api_prefix)
app.include_router(auth_router, prefix=settings.api_prefix)
app.include_router(admin_router, prefix=settings.api_prefix)
app.include_router(ai_router, prefix=settings.api_prefix)
