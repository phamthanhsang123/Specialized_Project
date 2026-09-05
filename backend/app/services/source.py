import ast
import difflib
import hashlib
import json
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import PurePosixPath
from uuid import uuid4

from sqlalchemy.orm import Session

from ..audit import record_event
from ..models import CodeVersion, FixProposal, Issue, Project, ReviewHistory, SourceFile, TestResult, new_id
from ..schemas import FileOut, FixProposalOut, IssueOut, ProjectOut, TestRunOut, VersionOut


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_SOURCE_BYTES = 10 * 1024 * 1024
MAX_PYTHON_FILES = 500
MAX_SOURCE_PATH_CHARS = 512
MAX_SOURCE_PATH_SEGMENT_CHARS = 255
_ZIP_READ_CHUNK_BYTES = 64 * 1024
_WINDOWS_INVALID_PATH_CHARS = frozenset('<>:"|?*')
_WINDOWS_RESERVED_PATH_STEMS = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{index}" for index in range(1, 10)}
    | {f"LPT{index}" for index in range(1, 10)}
)


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
    replacement_code: str | None
    reason: str


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def project_to_out(project: Project) -> ProjectOut:
    return ProjectOut(id=project.id, name=project.name, language=project.language,
                      updatedAt=project.updated_at.isoformat(), version=project.current_version)


def file_to_out(file: SourceFile) -> FileOut:
    return FileOut(id=file.id, path=file.path, sizeBytes=file.size_bytes, updatedAt=file.updated_at)


def issue_to_out(issue: Issue) -> IssueOut:
    return IssueOut(
        id=issue.id, filePath=issue.file.path, lineStart=issue.line_start, lineEnd=issue.line_end,
        ruleCode=issue.rule_code, type=issue.issue_type, severity=issue.severity,
        description=issue.description,
        # Static rules, including legacy demo rows, have no measured probability.
        confidence=None if issue.rule_code in {"B608", "SEC001", "B018", "B001", "SYNTAX"}
        or not issue.confidence else issue.confidence,
        status=issue.status, explanation=issue.explanation, impact=issue.impact,
    )


def proposal_to_out(proposal: FixProposal) -> FixProposalOut:
    return FixProposalOut(issueId=proposal.issue_id, originalCode=proposal.original_code,
                          replacementCode=proposal.replacement_code, reason=proposal.reason, patchText=proposal.diff)


def test_to_out(run: TestResult) -> TestRunOut:
    return TestRunOut(id=run.id, version=run.version, status=run.status, total=run.total,
                      passed=run.passed, failed=run.failed, errors=run.errors,
                      duration=run.duration, createdAt=run.created_at, output=run.output)


def version_to_out(version: CodeVersion) -> VersionOut:
    return VersionOut(id=version.id, version=version.version, sourcePath=version.source_path,
                      createdAt=version.created_at, createdBy=version.created_by)


def safe_upload_path(path: str) -> str:
    path = path.replace("\\", "/")
    parts = path.split("/")
    if (
        not path
        or path.startswith("/")
        or len(path) > MAX_SOURCE_PATH_CHARS
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError("Invalid upload path")
    for part in parts:
        normalized_part = unicodedata.normalize("NFKC", part)
        reserved_stem = normalized_part.split(".", 1)[0].upper()
        try:
            windows_segment_units = len(part.encode("utf-16-le")) // 2
        except UnicodeEncodeError as error:
            raise ValueError("Invalid upload path") from error
        if (
            windows_segment_units > MAX_SOURCE_PATH_SEGMENT_CHARS
            or part.endswith((" ", "."))
            or any(char in _WINDOWS_INVALID_PATH_CHARS or unicodedata.category(char) == "Cc" for char in part)
            or reserved_stem in _WINDOWS_RESERVED_PATH_STEMS
        ):
            raise ValueError("Invalid upload path")
    return str(PurePosixPath(path))


def _portable_upload_path_key(path: str) -> str:
    """Return a comparison key shared by common case-insensitive filesystems."""
    return unicodedata.normalize("NFKC", unicodedata.normalize("NFKC", path).casefold())


def _register_upload_path(seen_path_keys: set[str], path: str) -> None:
    path_key = _portable_upload_path_key(path)
    if path_key in seen_path_keys:
        raise ValueError(f"Duplicate upload path: {path}")
    seen_path_keys.add(path_key)


def _decode_python_source(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("Upload must be a valid ZIP or UTF-8 Python source file") from error


def _add_python_source(
    result: dict[str, str],
    path: str,
    data: bytes,
    total_bytes: int,
    seen_path_keys: set[str],
) -> int:
    normalized_path = safe_upload_path(path)
    _register_upload_path(seen_path_keys, normalized_path)
    if len(result) >= MAX_PYTHON_FILES:
        raise ValueError("Upload exceeds 500 Python files")
    total_bytes += len(data)
    if total_bytes > MAX_SOURCE_BYTES:
        raise ValueError("Upload exceeds the 10 MB extracted source limit")
    result[normalized_path] = _decode_python_source(data)
    return total_bytes


def _extract_zip(
    filename: str,
    data: bytes,
    result: dict[str, str],
    total_bytes: int,
    seen_path_keys: set[str],
) -> int:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            entries: list[tuple[zipfile.ZipInfo, str]] = []
            declared_bytes = 0
            archive_path_keys: set[str] = set()
            for item in archive.infolist():
                if item.is_dir() or not item.filename.lower().endswith(".py"):
                    continue
                path = safe_upload_path(item.filename)
                path_key = _portable_upload_path_key(path)
                if path_key in seen_path_keys or path_key in archive_path_keys:
                    raise ValueError(f"Duplicate upload path: {path}")
                if item.flag_bits & 0x1:
                    raise ValueError(f"Encrypted ZIP entry is not supported: {path}")
                if item.file_size < 0 or item.compress_size < 0:
                    raise ValueError(f"Invalid ZIP size metadata: {path}")
                archive_path_keys.add(path_key)
                entries.append((item, path))
                declared_bytes += item.file_size
                if len(result) + len(entries) > MAX_PYTHON_FILES:
                    raise ValueError("Upload exceeds 500 Python files")
                if total_bytes + declared_bytes > MAX_SOURCE_BYTES:
                    raise ValueError("Upload exceeds the 10 MB extracted source limit")

            for item, path in entries:
                chunks: list[bytes] = []
                actual_size = 0
                with archive.open(item) as member:
                    while chunk := member.read(_ZIP_READ_CHUNK_BYTES):
                        actual_size += len(chunk)
                        if total_bytes + actual_size > MAX_SOURCE_BYTES:
                            raise ValueError("Upload exceeds the 10 MB extracted source limit")
                        chunks.append(chunk)
                if actual_size != item.file_size:
                    raise ValueError(f"Invalid ZIP size metadata: {path}")
                total_bytes = _add_python_source(result, path, b"".join(chunks), total_bytes, seen_path_keys)
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError) as error:
        raise ValueError(f"{filename} must be a valid ZIP archive") from error
    return total_bytes


def extract_python_uploads(uploads: list[tuple[str, bytes]]) -> dict[str, str]:
    """Validate and combine one ZIP or one-or-more Python multipart uploads."""
    if not uploads:
        return {}
    if sum(len(data) for _, data in uploads) > MAX_UPLOAD_BYTES:
        raise ValueError("Upload exceeds the 10 MB limit")

    zip_count = sum(filename.lower().endswith(".zip") for filename, _ in uploads)
    if zip_count and (zip_count != 1 or len(uploads) != 1):
        raise ValueError("Upload one ZIP file or one or more .py files")
    if any(not filename.lower().endswith((".py", ".zip")) for filename, _ in uploads):
        raise ValueError("Only .py or .zip uploads are supported")

    result: dict[str, str] = {}
    seen_path_keys: set[str] = set()
    total_bytes = 0
    for filename, data in uploads:
        if filename.lower().endswith(".zip"):
            total_bytes = _extract_zip(filename, data, result, total_bytes, seen_path_keys)
        else:
            total_bytes = _add_python_source(result, filename, data, total_bytes, seen_path_keys)
    return result


def extract_python_files(filename: str, data: bytes) -> dict[str, str]:
    """Backward-compatible helper for callers that upload one file."""
    return extract_python_uploads([(filename, data)])


def next_version(project: Project) -> str:
    numbers = [int(name[1:]) for name in [project.current_version, *(version.version for version in project.versions)]
               if re.fullmatch(r"v\d+", name)]
    return f"v{max(numbers, default=0) + 1}"


def create_snapshot(db: Session, project: Project, created_by: str | None = None) -> CodeVersion:
    db.flush()
    files = db.query(SourceFile).filter(SourceFile.project_id == project.id).order_by(SourceFile.path).populate_existing().all()
    snapshot = {file.path: file.content for file in files}
    existing = db.query(CodeVersion).filter(CodeVersion.project_id == project.id,
                                           CodeVersion.version == project.current_version).first()
    if existing is not None:
        if json.loads(existing.snapshot_json) != snapshot:
            raise ValueError("Current source does not match its recorded version; reload the project")
        return existing
    version = CodeVersion(project=project, version=project.current_version,
                          source_path=f"storage/{project.id}/{project.current_version}",
                          snapshot_json=json.dumps(snapshot, ensure_ascii=False), created_by=created_by)
    db.add(version)
    db.flush()
    return version


def _clear_issues(db: Session, project: Project) -> None:
    # Delete referenced children before replacing source files on FK-enforcing DBs.
    for issue in db.query(Issue).filter(Issue.project_id == project.id).all():
        db.delete(issue)
    db.flush()
    db.expire(project, ["issues"])


def _lock_project(db: Session, project: Project) -> None:
    db.flush()
    db.query(Project).filter(Project.id == project.id).with_for_update().populate_existing().one()
    db.expire(project, ["files", "versions", "issues"])


def replace_project_files(db: Session, project: Project, files: dict[str, str]) -> list[SourceFile]:
    normalized_files: dict[str, str] = {}
    seen_path_keys: set[str] = set()
    for path, content in files.items():
        normalized_path = safe_upload_path(path)
        _register_upload_path(seen_path_keys, normalized_path)
        normalized_files[normalized_path] = content
    files = normalized_files
    _lock_project(db, project)
    create_snapshot(db, project)
    new_version = next_version(project)
    _clear_issues(db, project)
    project.files.clear()
    db.flush()
    created: list[SourceFile] = []
    for path, content in sorted(files.items()):
        source_file = SourceFile(project=project, path=path, content=content, size_bytes=len(content.encode("utf-8")))
        db.add(source_file)
        created.append(source_file)
    project.current_version = new_version
    project.updated_at = datetime.utcnow()
    db.flush()
    create_snapshot(db, project)
    return created


def make_diff(path: str, original: str, replacement: str) -> str:
    return "\n".join(difflib.unified_diff(original.splitlines(), replacement.splitlines(),
                                        fromfile=f"a/{path}", tofile=f"b/{path}", lineterm=""))


def _has_zero_guard(node: ast.Return, parents: dict[ast.AST, ast.AST], name: str) -> bool:
    parent = parents.get(node)
    if parent is None:
        return False
    for _, statements in ast.iter_fields(parent):
        if not isinstance(statements, list) or node not in statements:
            continue
        position = statements.index(node)
        if position == 0:
            continue
        previous = statements[position - 1]
        if not isinstance(previous, ast.If) or not isinstance(previous.test, ast.Compare):
            continue
        test = previous.test
        if (isinstance(test.left, ast.Name) and test.left.id == name and len(test.ops) == 1
                and isinstance(test.ops[0], ast.Eq) and isinstance(test.comparators[0], ast.Constant)
                and test.comparators[0].value == 0 and previous.body
                and isinstance(previous.body[-1], (ast.Raise, ast.Return))):
            return True
    return False


def scan_file(file: SourceFile) -> list[DetectedIssue]:
    """Conservative Python AST checks; unsupported fixes stay manual-review findings."""
    found: list[DetectedIssue] = []
    lines = file.content.splitlines()

    def add(line_no: int, rule_code: str, issue_type: str, severity: str, description: str,
            explanation: str, impact: str, replacement: str | None, reason: str) -> None:
        found.append(DetectedIssue(file=file, line=line_no, rule_code=rule_code, issue_type=issue_type,
                                   severity=severity, description=description, explanation=explanation,
                                   impact=impact, original_code=lines[line_no - 1] if 1 <= line_no <= len(lines) else "",
                                   replacement_code=replacement, reason=reason))

    try:
        tree = ast.parse(file.content, filename=file.path)
        compile(tree, file.path, "exec")
    except SyntaxError as error:
        add(error.lineno or 1, "SYNTAX", "Python Syntax", "HIGH", str(error.msg),
            "Python could not parse this file; static checks require valid syntax.",
            "The file cannot run until the syntax error is corrected.", None,
            "Correct the syntax and scan again.")
        return found

    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    # A local import is safe only if it cannot shadow another use of os.
    os_import_lines = [node.lineno for node in tree.body if isinstance(node, ast.Import)
                       and any(alias.name == "os" and alias.asname in {None, "os"} for alias in node.names)]
    os_names = [node for node in ast.walk(tree) if isinstance(node, ast.Name) and node.id == "os"]
    os_shadowed = any(
        isinstance(node, ast.Name) and node.id == "os" and isinstance(node.ctx, (ast.Store, ast.Del))
        or isinstance(node, ast.arg) and node.arg == "os"
        or isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.ExceptHandler)) and node.name == "os"
        or isinstance(node, ast.ImportFrom) and any((alias.asname or alias.name) in {"os", "*"} for alias in node.names)
        or isinstance(node, ast.Import) and any(alias.name != "os" and (alias.asname or alias.name.split(".")[0]) == "os" for alias in node.names)
        for node in ast.walk(tree)
    )
    reported_sql: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            contains_sql = any(isinstance(child, ast.Constant) and isinstance(child.value, str)
                               and re.search(r"\b(SELECT|INSERT|UPDATE|DELETE)\b", child.value, re.IGNORECASE)
                               for child in ast.walk(node))
            contains_value = any(isinstance(child, (ast.Name, ast.Call, ast.Attribute, ast.Subscript))
                                 for child in ast.walk(node))
            if contains_sql and contains_value and node.lineno not in reported_sql:
                reported_sql.add(node.lineno)
                add(node.lineno, "B608", "Possible SQL Injection", "CRITICAL",
                    "SQL text is assembled by concatenating a dynamic value.",
                    "If the value is user-controlled, it can change SQL syntax. Review its origin.",
                    "An attacker may read or change database records.", None,
                    "Use the database driver's parameter API at the execute call. A safe automatic fix needs the driver and bindings.")
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.lineno == node.end_lineno:
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if len(targets) == 1 and isinstance(targets[0], ast.Name) and targets[0].id in {"API_KEY", "SECRET", "PASSWORD", "TOKEN"}:
                if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str) and node.value.value:
                    key = targets[0].id
                    line = lines[node.lineno - 1]
                    indent = line[:len(line) - len(line.lstrip())]
                    replacement = None
                    if line.lstrip().startswith(key) and ";" not in line and not os_shadowed:
                        context = node
                        while parents.get(context) is not tree and context in parents:
                            context = parents[context]
                        has_os_import = any(number < context.lineno for number in os_import_lines)
                        prefix = "" if has_os_import else f"{indent}import os\n"
                        if has_os_import or not os_names:
                            annotation = f": {ast.get_source_segment(file.content, node.annotation)}" if isinstance(node, ast.AnnAssign) else ""
                            replacement = f'{prefix}{indent}{key}{annotation} = os.environ["{key}"]'
                    add(node.lineno, "SEC001", "Hard-coded Secret", "CRITICAL",
                        "A nonempty secret value is written directly in source code.",
                        "A committed secret can be exposed through source history or shared archives.",
                        "Anyone with the secret may access its external service.", replacement,
                        f"Read {key} from the environment and configure it before running. Rotate a real exposed secret.")
        if isinstance(node, ast.Return) and isinstance(node.value, ast.BinOp) and isinstance(node.value.op, ast.Div):
            denominator = node.value.right
            if isinstance(denominator, ast.Name) and node.lineno == node.end_lineno and not _has_zero_guard(node, parents, denominator.id):
                line = lines[node.lineno - 1]
                indent = line[:len(line) - len(line.lstrip())]
                replacement = None
                if line.lstrip().startswith("return ") and ";" not in line:
                    unit = "\t" if "\t" in indent else "    "
                    replacement = (f"{indent}if {denominator.id} == 0:\n"
                                   f'{indent}{unit}raise ValueError("{denominator.id} must not be zero")\n{line}')
                add(node.lineno, "B018", "Possible Division by Zero", "HIGH",
                    "A returned division uses a variable denominator without an adjacent zero guard.",
                    "This heuristic cannot prove the denominator is nonzero; review caller validation.",
                    "A zero value raises ZeroDivisionError.", replacement,
                    "Reject a zero denominator explicitly. Check that ValueError matches the function's contract.")
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            line = lines[node.lineno - 1]
            indent = line[:len(line) - len(line.lstrip())]
            replacement = f"{indent}except Exception:" if re.fullmatch(r"\s*except\s*:\s*(#.*)?", line) else None
            add(node.lineno, "B001", "Bare Except", "MEDIUM", "A bare except also catches process-control exceptions.",
                "SystemExit and KeyboardInterrupt are caught along with ordinary application errors.",
                "Interrupting or shutting down the application can stop working.", replacement,
                "Catch Exception for application errors; a concrete exception is preferable when known.")
    return sorted(found, key=lambda item: (item.line, item.rule_code))


def scan_project(db: Session, project: Project) -> list[Issue]:
    _lock_project(db, project)
    _clear_issues(db, project)
    created: list[Issue] = []
    for source_file in db.query(SourceFile).filter(SourceFile.project_id == project.id).order_by(SourceFile.path).populate_existing().all():
        if not source_file.path.lower().endswith(".py"):
            continue
        for detected in scan_file(source_file):
            issue = Issue(id=f"ISS-{uuid4().hex}", project=project, file=source_file,
                          issue_type=detected.issue_type, rule_code=detected.rule_code,
                          severity=detected.severity, description=detected.description,
                          explanation=detected.explanation, impact=detected.impact,
                          line_start=detected.line, line_end=detected.line, confidence=0.0, status="PENDING")
            db.add(issue)
            if detected.replacement_code is not None and detected.replacement_code != detected.original_code:
                db.add(FixProposal(issue=issue, original_code=detected.original_code,
                                   replacement_code=detected.replacement_code,
                                   diff=make_diff(source_file.path, detected.original_code, detected.replacement_code),
                                   reason=detected.reason, base_source_hash=content_hash(source_file.content)))
            created.append(issue)
    db.flush()
    return created


def review_issue(db: Session, issue: Issue, action: str, reviewer_id: str | None = None) -> Issue:
    if action not in {"ACCEPTED", "REJECTED"}:
        raise ValueError("Review action must be ACCEPTED or REJECTED")
    if issue.status not in {"PENDING", "ACCEPTED", "REJECTED"}:
        raise ValueError("An applied finding cannot be reviewed again; scan the current version")
    if action == "ACCEPTED" and not issue.proposal:
        raise ValueError("This finding requires a manual fix; no safe proposal is available")
    if action == "ACCEPTED" and not issue.proposal.base_source_hash:
        raise ValueError("Đề xuất từ bản cũ chưa được kiểm tra. Hãy quét source để tạo và duyệt lại.")
    issue.status = action
    if issue.proposal:
        issue.proposal.status = action
        issue.proposal.reviewed_at = datetime.utcnow()
    history = ReviewHistory(id=new_id("rev"), issue_id=issue.id, action=action, reviewer_id=reviewer_id)
    db.add(history)
    record_event(db, action, actor_id=reviewer_id, project_id=issue.project_id,
                 detail=json.dumps({"issue_id": issue.id, "type": issue.issue_type, "file_path": issue.file.path, "review_id": history.id}, ensure_ascii=False))
    return issue


def apply_accepted_fixes(db: Session, project: Project) -> int:
    _lock_project(db, project)
    accepted = db.query(Issue).filter(Issue.project_id == project.id, Issue.status == "ACCEPTED").all()
    if not accepted:
        return 0
    changes: dict[str, tuple[SourceFile, str]] = {}
    grouped: dict[str, list[Issue]] = {}
    for issue in accepted:
        if issue.proposal is None:
            raise ValueError(f"{issue.id}: no proposal is available")
        grouped.setdefault(issue.file_id, []).append(issue)
    # Validate ALL candidate files before mutating any source or status.
    for file_id, issues in grouped.items():
        source_file = db.get(SourceFile, file_id)
        if source_file is None:
            raise ValueError("A proposal's source file no longer exists; scan again")
        db.refresh(source_file)
        source = source_file.content
        lines = source.splitlines(keepends=True)
        previous_start = len(lines) + 1
        for issue in sorted(issues, key=lambda item: item.line_start, reverse=True):
            proposal = issue.proposal
            assert proposal is not None
            if not proposal.base_source_hash:
                raise ValueError("Đề xuất từ bản cũ chưa được kiểm tra. Hãy quét source để tạo và duyệt lại.")
            if proposal.base_source_hash != content_hash(source):
                raise ValueError(f"{issue.id}: source changed since the proposal was generated; scan again")
            start, end = issue.line_start - 1, issue.line_end
            if start < 0 or end > len(lines) or start >= end or end > previous_start:
                raise ValueError(f"{issue.id}: invalid or overlapping patch range; review one proposal at a time")
            old_segment = "".join(lines[start:end])
            if old_segment.rstrip("\r\n") != proposal.original_code.rstrip("\r\n"):
                raise ValueError(f"{issue.id}: original code no longer matches its line range; scan again")
            newline = "\r\n" if "\r\n" in old_segment else "\n"
            replacement = proposal.replacement_code.replace("\r\n", "\n").replace("\n", newline).rstrip("\r\n")
            if old_segment.endswith(("\r", "\n")):
                replacement += newline
            if replacement == old_segment:
                raise ValueError(f"{issue.id}: the proposal does not change source code")
            lines[start:end] = replacement.splitlines(keepends=True)
            previous_start = start
        candidate = "".join(lines)
        try:
            compile(candidate, source_file.path, "exec")
        except SyntaxError as error:
            raise ValueError(f"Patch rejected: {source_file.path}:{error.lineno}: {error.msg}") from error
        changes[file_id] = (source_file, candidate)
    create_snapshot(db, project)
    new_version = next_version(project)
    for source_file, candidate in changes.values():
        source_file.content = candidate
        source_file.size_bytes = len(candidate.encode("utf-8"))
    for issue in accepted:
        issue.status = "APPLIED"
        issue.proposal.status = "APPLIED"
    project.current_version = new_version
    project.updated_at = datetime.utcnow()
    db.flush()
    create_snapshot(db, project)
    return len(accepted)


def rollback_project(db: Session, project: Project, target_version: str | None = None) -> CodeVersion:
    _lock_project(db, project)
    query = db.query(CodeVersion).filter(CodeVersion.project_id == project.id)
    if target_version:
        version = query.filter(CodeVersion.version == target_version).order_by(CodeVersion.created_at.desc()).first()
    else:
        candidates = query.filter(CodeVersion.version != project.current_version).all()
        # Creation timestamps can tie within one clock tick; use version numbers.
        version = max(candidates, key=lambda item: (int(item.version[1:]) if re.fullmatch(r"v\d+", item.version) else -1,
                                                    item.created_at), default=None)
    if version is None:
        raise ValueError("No rollback version available")
    if version.version == project.current_version:
        raise ValueError("The selected version is already current")
    snapshot = json.loads(version.snapshot_json)
    replace_project_files(db, project, snapshot)
    restored = create_snapshot(db, project)
    restored.created_by = f"rollback:{version.version}"
    return restored
