import json
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import PurePosixPath

from sqlalchemy.orm import Session

from ..models import CodeVersion, FixProposal, Issue, Project, ReviewHistory, SourceFile, TestResult
from ..schemas import FileOut, FixProposalOut, IssueOut, ProjectOut, TestRunOut, VersionOut


@dataclass
class DetectedIssue:
    file: SourceFile
    line: int
    rule_code: str
    issue_type: str
    severity: str
    description: str
    explanation: str
    impact: str
    original_code: str
    replacement_code: str
    reason: str


def project_to_out(project: Project) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        language=project.language,
        updatedAt=project.updated_at.isoformat(),
        version=project.current_version,
    )


def file_to_out(file: SourceFile) -> FileOut:
    return FileOut(id=file.id, path=file.path, sizeBytes=file.size_bytes, updatedAt=file.updated_at)


def issue_to_out(issue: Issue) -> IssueOut:
    return IssueOut(
        id=issue.id,
        filePath=issue.file.path,
        lineStart=issue.line_start,
        lineEnd=issue.line_end,
        ruleCode=issue.rule_code,
        type=issue.issue_type,
        severity=issue.severity,  # type: ignore[arg-type]
        description=issue.description,
        confidence=issue.confidence,
        status=issue.status,  # type: ignore[arg-type]
        explanation=issue.explanation,
        impact=issue.impact,
    )


def proposal_to_out(proposal: FixProposal) -> FixProposalOut:
    return FixProposalOut(
        issueId=proposal.issue_id,
        originalCode=proposal.original_code,
        replacementCode=proposal.replacement_code,
        reason=proposal.reason,
        patchText=proposal.diff,
    )


def test_to_out(run: TestResult) -> TestRunOut:
    return TestRunOut(
        id=run.id,
        version=run.version,
        status=run.status,  # type: ignore[arg-type]
        total=run.total,
        passed=run.passed,
        failed=run.failed,
        errors=run.errors,
        duration=run.duration,
        createdAt=run.created_at,
    )


def version_to_out(version: CodeVersion) -> VersionOut:
    return VersionOut(
        id=version.id,
        version=version.version,
        sourcePath=version.source_path,
        createdAt=version.created_at,
        createdBy=version.created_by,
    )


def safe_upload_path(path: str) -> str:
    normalized = str(PurePosixPath(path.replace("\\", "/")))
    if normalized.startswith("../") or normalized == ".." or normalized.startswith("/"):
        raise ValueError("Invalid upload path")
    return normalized


def extract_python_files(filename: str, data: bytes) -> dict[str, str]:
    if filename.lower().endswith(".zip"):
        result: dict[str, str] = {}
        with zipfile.ZipFile(BytesIO(data)) as archive:
            for item in archive.infolist():
                if item.is_dir() or not item.filename.lower().endswith(".py"):
                    continue
                path = safe_upload_path(item.filename)
                result[path] = archive.read(item).decode("utf-8", errors="replace")
        return result
    if filename.lower().endswith(".py"):
        return {safe_upload_path(filename): data.decode("utf-8", errors="replace")}
    raise ValueError("Only .py or .zip uploads are supported")


def next_version(project: Project) -> str:
    try:
        number = int(project.current_version.removeprefix("v")) + 1
    except ValueError:
        number = 1
    return f"v{number}"


def create_snapshot(db: Session, project: Project, created_by: str | None = None) -> CodeVersion:
    files = db.query(SourceFile).filter(SourceFile.project_id == project.id).order_by(SourceFile.path).all()
    snapshot = {file.path: file.content for file in files}
    version = CodeVersion(
        project_id=project.id,
        version=project.current_version,
        source_path=f"storage/{project.id}/{project.current_version}",
        snapshot_json=json.dumps(snapshot, ensure_ascii=False),
        created_by=created_by,
    )
    db.add(version)
    return version


def replace_project_files(db: Session, project: Project, files: dict[str, str]) -> list[SourceFile]:
    for existing in list(project.files):
        db.delete(existing)
    db.flush()
    created: list[SourceFile] = []
    for path, content in sorted(files.items()):
        source_file = SourceFile(project_id=project.id, path=path, content=content, size_bytes=len(content.encode("utf-8")))
        db.add(source_file)
        created.append(source_file)
    project.current_version = next_version(project)
    db.flush()
    create_snapshot(db, project)
    return created


def make_diff(path: str, original: str, replacement: str) -> str:
    return "\n".join(
        [
            f"--- a/{path}",
            f"+++ b/{path}",
            "@@",
            f"-{original}",
            f"+{replacement}",
        ]
    )


def scan_file(file: SourceFile) -> list[DetectedIssue]:
    found: list[DetectedIssue] = []
    lines = file.content.splitlines()

    def add(line_no: int, rule_code: str, issue_type: str, severity: str, description: str, explanation: str, impact: str, replacement: str, reason: str) -> None:
        original = lines[line_no - 1]
        found.append(
            DetectedIssue(
                file=file,
                line=line_no,
                rule_code=rule_code,
                issue_type=issue_type,
                severity=severity,
                description=description,
                explanation=explanation,
                impact=impact,
                original_code=original,
                replacement_code=replacement,
                reason=reason,
            )
        )

    for index, line in enumerate(lines, start=1):
        if re.search(r"SELECT.*\+|\+.*SELECT", line, flags=re.IGNORECASE):
            add(
                index,
                "B608",
                "SQL Injection",
                "CRITICAL",
                "SQL query is built by string concatenation with user input.",
                "User-controlled text is mixed directly into SQL syntax.",
                "Attackers may bypass authentication or read/update data without permission.",
                re.sub(r'"SELECT(.*)"\s*\+\s*(\w+)', r'"SELECT\1?"', line),
                "Use parameterized queries so input is treated as data, not SQL syntax.",
            )
        if re.search(r"\b(API_KEY|SECRET|PASSWORD|TOKEN)\s*=\s*['\"]", line):
            key = line.split("=", 1)[0].strip()
            add(
                index,
                "SEC001",
                "Hard-coded Secret",
                "CRITICAL",
                "A secret value is written directly in source code.",
                "Secrets committed to Git can leak through history, logs, or shared archives.",
                "The external service or payment gateway may be compromised.",
                f"{key} = os.environ[\"{key}\"]",
                "Read secrets from environment variables and configure them on the server.",
            )
        if re.search(r"return\s+.+/\s*[a-zA-Z_][a-zA-Z0-9_]*", line):
            denominator = line.rsplit("/", 1)[-1].strip()
            add(
                index,
                "B018",
                "Division by Zero",
                "HIGH",
                "The denominator is not checked before division.",
                "Invalid input may raise ZeroDivisionError.",
                "The API may return 500 and interrupt the user workflow.",
                f"if {denominator} == 0:\n    raise ValueError(\"{denominator} must not be zero\")\n{line}",
                "Validate boundary values before running the division.",
            )
        if re.match(r"^\s*except\s*:\s*$", line):
            indent = line[: len(line) - len(line.lstrip())]
            add(
                index,
                "B001",
                "Bare Except",
                "MEDIUM",
                "A bare except hides unexpected runtime errors.",
                "All exceptions are swallowed without classification.",
                "Troubleshooting production incidents becomes harder.",
                f"{indent}except Exception as error:",
                "Catch a concrete exception where possible, or at least bind and log the error.",
            )
    return found


def scan_project(db: Session, project: Project) -> list[Issue]:
    for issue in list(project.issues):
        db.delete(issue)
    db.flush()

    created: list[Issue] = []
    sequence = 1
    for source_file in project.files:
        if not source_file.path.lower().endswith(".py"):
            continue
        for detected in scan_file(source_file):
            issue = Issue(
                id=f"ISS-{sequence:03d}",
                project_id=project.id,
                file_id=detected.file.id,
                issue_type=detected.issue_type,
                rule_code=detected.rule_code,
                severity=detected.severity,
                description=detected.description,
                explanation=detected.explanation,
                impact=detected.impact,
                line_start=detected.line,
                line_end=detected.line,
                confidence=0.9,
                status="PENDING",
            )
            proposal = FixProposal(
                issue=issue,
                original_code=detected.original_code,
                replacement_code=detected.replacement_code,
                diff=make_diff(source_file.path, detected.original_code, detected.replacement_code),
                reason=detected.reason,
            )
            db.add(issue)
            db.add(proposal)
            created.append(issue)
            sequence += 1
    return created


def review_issue(db: Session, issue: Issue, action: str) -> Issue:
    issue.status = action
    if issue.proposal:
        issue.proposal.status = action
        issue.proposal.reviewed_at = datetime.utcnow()
    db.add(ReviewHistory(issue_id=issue.id, action=action))
    return issue


def apply_accepted_fixes(db: Session, project: Project) -> int:
    applied = 0
    for issue in project.issues:
        if issue.status != "ACCEPTED" or not issue.proposal:
            continue
        source_file = issue.file
        source_file.content = source_file.content.replace(issue.proposal.original_code, issue.proposal.replacement_code, 1)
        source_file.size_bytes = len(source_file.content.encode("utf-8"))
        issue.status = "APPLIED"
        issue.proposal.status = "APPLIED"
        applied += 1
    if applied:
        project.current_version = next_version(project)
        create_snapshot(db, project)
    return applied


def rollback_project(db: Session, project: Project, target_version: str | None = None) -> CodeVersion:
    query = db.query(CodeVersion).filter(CodeVersion.project_id == project.id)
    if target_version:
        version = query.filter(CodeVersion.version == target_version).order_by(CodeVersion.created_at.desc()).first()
    else:
        version = query.order_by(CodeVersion.created_at.desc()).offset(1).first()
    if version is None:
        raise ValueError("No rollback version available")

    snapshot = json.loads(version.snapshot_json)
    for existing in list(project.files):
        db.delete(existing)
    db.flush()
    for path, content in snapshot.items():
        db.add(SourceFile(project_id=project.id, path=path, content=content, size_bytes=len(content.encode("utf-8"))))
    project.current_version = version.version
    return version


def create_fake_test_run(db: Session, project: Project) -> TestResult:
    pending = sum(1 for issue in project.issues if issue.status in {"PENDING", "ACCEPTED"})
    total = 20
    failed = min(6, pending)
    errors = 1 if any(issue.severity == "CRITICAL" and issue.status != "APPLIED" for issue in project.issues) else 0
    passed = max(total - failed - errors, 0)
    run = TestResult(
        project_id=project.id,
        version=project.current_version,
        status="PASS" if failed == 0 and errors == 0 else "FAIL",
        total=total,
        passed=passed,
        failed=failed,
        errors=errors,
        duration="2.84s",
        output="Simulated pytest result. TV4 can replace this endpoint with Docker sandbox output.",
    )
    db.add(run)
    return run
