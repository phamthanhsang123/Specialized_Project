"""Run project code only inside a restricted Docker container, never on the API host."""

import base64
import json
import shutil
import subprocess
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from uuid import uuid4

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Issue, Project, SourceFile, TestCase, TestResult


class SandboxUnavailable(RuntimeError):
    pass


class TestingError(ValueError):
    pass


def list_test_cases(db: Session, project: Project) -> list[dict]:
    cases = db.query(TestCase).filter(TestCase.project_id == project.id).order_by(TestCase.created_at).all()
    return [{"id": case.id, "name": case.name, "code": case.input_data or ""} for case in cases]


def save_test_case(db: Session, project: Project, name: str, code: str) -> dict:
    name = name.strip()
    if not name or len(name) > 255 or not code.strip() or len(code.encode("utf-8")) > 128_000:
        raise TestingError("Tên test và mã pytest hợp lệ là bắt buộc (tối đa 128 KB).")
    try:
        compile(code, name, "exec")
    except SyntaxError as error:
        raise TestingError(f"Test sai cú pháp Python ở dòng {error.lineno}: {error.msg}") from error
    case = db.query(TestCase).filter(TestCase.project_id == project.id, TestCase.name == name).first()
    if case is None:
        case = TestCase(project_id=project.id, name=name)
        db.add(case)
    case.input_data = code
    case.status = "ACTIVE"
    db.flush()
    return {"id": case.id, "name": case.name, "code": code}


def _docker(args: list[str], timeout: int = 15) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(["docker", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SandboxUnavailable("Không kết nối được Docker. Hãy mở Docker Desktop và bật Linux containers.") from error
    return result


def _safe_file(root: Path, name: str) -> Path:
    path = PurePosixPath(name.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or not path.parts or any(":" in part for part in path.parts):
        raise TestingError("Đường dẫn source không hợp lệ.")
    target = root.joinpath(*path.parts).resolve()
    if not target.is_relative_to(root.resolve()):
        raise TestingError("Đường dẫn source nằm ngoài project.")
    return target


def _attach(container: str, timeout: int) -> tuple[int, str, bool]:
    """Drain continuously with bounded memory, retaining the final JUnit frame."""
    process = subprocess.Popen(["docker", "start", "--attach", container], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    tail = bytearray()

    def drain() -> None:
        assert process.stdout is not None
        while chunk := process.stdout.read(4096):
            tail.extend(chunk)
            if len(tail) > 2_000_000:
                del tail[:-2_000_000]

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    timed_out = False
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            _docker(["kill", container], timeout=5)
        finally:
            process.kill()
            process.wait(timeout=5)
    finally:
        reader.join(timeout=5)
    return process.returncode, tail.decode("utf-8", errors="replace"), timed_out


def _report(xml: bytes, exit_code: int) -> dict:
    if len(xml) > 2_000_000 or b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise TestingError("Báo cáo pytest vượt giới hạn hoặc không hợp lệ.")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as error:
        raise TestingError("Không đọc được báo cáo pytest.") from error
    cases = list(root.iter("testcase"))
    failed = sum(case.find("failure") is not None for case in cases)
    errors = sum(case.find("error") is not None for case in cases)
    skipped = sum(case.find("skipped") is not None for case in cases)
    passed = len(cases) - failed - errors - skipped
    # No collected/executed tests is never evidence that a fix was verified.
    status = "PASS" if exit_code == 0 and passed > 0 and failed == 0 and errors == 0 and skipped == 0 else "FAIL"
    return {"status": status, "total": len(cases), "passed": passed, "failed": failed, "errors": errors, "skipped": skipped}


def run_project_tests(db: Session, project: Project) -> TestResult:
    settings = get_settings()
    files = db.query(SourceFile).filter(SourceFile.project_id == project.id).all()
    cases = db.query(TestCase).filter(TestCase.project_id == project.id, TestCase.status == "ACTIVE").all()
    uploaded_tests = [file.path for file in files if PurePosixPath(file.path).name.startswith("test_") or PurePosixPath(file.path).name.endswith("_test.py")]
    if len(cases) > 100 or sum(len((case.input_data or "").encode("utf-8")) for case in cases) > 10_000_000:
        raise TestingError("Bộ test vượt giới hạn 100 module hoặc 10 MB.")
    if not cases and not uploaded_tests:
        raise TestingError("Chưa có test. Thêm mã pytest hoặc upload project chứa test_*.py trước khi chạy.")
    if shutil.which("docker") is None:
        raise SandboxUnavailable("Chưa cài Docker. Test chỉ được chạy trong sandbox, không chạy trực tiếp trên máy chủ.")
    check = _docker(["info", "--format", "{{.OSType}}"])
    if check.returncode != 0 or check.stdout.strip() != "linux":
        raise SandboxUnavailable("Docker chưa sẵn sàng. Hãy mở Docker Desktop và bật Linux containers.")
    image = settings.sandbox_image
    if _docker(["image", "inspect", image]).returncode != 0:
        raise SandboxUnavailable(f"Chưa có image {image}. Chạy: docker build -t {image} backend/sandbox")

    container = f"sentinel-test-{uuid4().hex}"
    version = project.current_version
    start = time.monotonic()
    metrics = {"status": "FAIL", "total": 0, "passed": 0, "failed": 0, "errors": 1, "skipped": 0}
    log = ""
    with tempfile.TemporaryDirectory(prefix="sentinel-tests-") as temp:
        root = Path(temp)
        workspace = root / "workspace"
        workspace.mkdir()
        size = 0
        for file in files:
            if not file.path.lower().endswith(".py"):
                continue
            size += len(file.content.encode("utf-8"))
            if size > 10_000_000:
                raise TestingError("Project vượt giới hạn sandbox 10 MB.")
            if ".sentinel-tests" in PurePosixPath(file.path).parts:
                raise TestingError("Tên thư mục .sentinel-tests được dành cho test runner.")
            destination = _safe_file(workspace, file.path)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(file.content, encoding="utf-8")
        test_paths = [f"/workspace/{path}" for path in uploaded_tests]
        if cases:
            test_dir = workspace / ".sentinel-tests"
            test_dir.mkdir()
            for index, case in enumerate(cases):
                (test_dir / f"test_saved_{index}.py").write_text(case.input_data or "", encoding="utf-8")
            test_paths.append("/workspace/.sentinel-tests")
        args = [
            "create", "--name", container, "--network", "none", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges", "--pids-limit", "64", "--memory", settings.sandbox_memory,
            "--memory-swap", settings.sandbox_memory, "--cpus", str(settings.sandbox_cpus),
            "--user", "65534:65534", "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m,mode=1777",
            "--ulimit", "fsize=2097152:2097152",
            "--mount", f"type=bind,source={workspace},target=/workspace,readonly", "--workdir", "/workspace",
            "--env", "PYTHONDONTWRITEBYTECODE=1", "--env", "PYTEST_DISABLE_PLUGIN_AUTOLOAD=1",
            "--env", "PYTHONPATH=/workspace", image, "python", "/opt/sentinel/runner.py", *test_paths,
        ]
        try:
            created = _docker(args)
            if created.returncode != 0:
                raise SandboxUnavailable("Không tạo được Docker sandbox: " + created.stderr[-2000:])
            exit_code, log, timed_out = _attach(container, settings.sandbox_timeout_seconds)
            if timed_out:
                log += f"\nSandbox bị dừng sau {settings.sandbox_timeout_seconds} giây."
            else:
                # Inspect the container exit code, not just the attach client's return code.
                inspected = _docker(["inspect", "--format", "{{json .State}}", container])
                if inspected.returncode == 0:
                    state = json.loads(inspected.stdout)
                    exit_code = state.get("ExitCode", exit_code)
                    if state.get("OOMKilled"):
                        log += "\nSandbox vượt giới hạn bộ nhớ."
                # The image's wrapper emits JUnit before exit: tmpfs vanishes when a
                # container stops. No writable host path/volume is needed for reports.
                prefix = "\n__SENTINEL_JUNIT_V1__="
                offset = log.rfind(prefix)
                if offset >= 0:
                    frame = log[offset + len(prefix):].partition("\n")[0].strip()
                    log = log[:offset]
                    try:
                        metrics = _report(base64.b64decode(frame, validate=True), exit_code)
                    except (TestingError, ValueError) as error:
                        log += "\n" + str(error)
                else:
                    log += "\nKhông có báo cáo pytest hợp lệ; chưa thể xác minh bản sửa."
        finally:
            try:
                _docker(["rm", "--force", container], timeout=10)
            except SandboxUnavailable:
                pass

    log += f"\nSkipped: {metrics.pop('skipped')}. Kết quả từ pytest trong Docker, version {version}."
    run = TestResult(project_id=project.id, version=version, duration=f"{time.monotonic() - start:.2f}s", output=log[-65536:], **metrics)
    db.add(run)
    db.refresh(project)
    if project.current_version == version:
        issues = db.query(Issue).filter(Issue.project_id == project.id, Issue.status.in_(["APPLIED", "VERIFIED", "FAILED"])).all()
        for issue in issues:
            issue.status = "VERIFIED" if metrics["status"] == "PASS" else "FAILED"
            if issue.proposal:
                issue.proposal.status = issue.status
    return run
