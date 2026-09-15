"""Create short-lived web previews in isolated Daytona sandboxes."""

from __future__ import annotations

import json
import re
import shlex
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import CodeVersion, Project, SourceFile
from .source import safe_upload_path


class PreviewUnavailable(RuntimeError):
    pass


class PreviewError(ValueError):
    pass


@dataclass
class _LivePreview:
    project_id: str
    client: Any
    sandboxes: list[Any]


_sessions: dict[str, _LivePreview] = {}
_sessions_lock = threading.RLock()


def configured() -> bool:
    return bool(get_settings().daytona_api_key.strip())


def _daytona_client():
    settings = get_settings()
    if not settings.daytona_api_key.strip():
        raise PreviewUnavailable(
            "Chưa cấu hình Daytona. Thêm DAYTONA_API_KEY vào backend/.env rồi khởi động lại backend."
        )
    try:
        from daytona import Daytona, DaytonaConfig
    except ImportError as error:
        raise PreviewUnavailable(
            "Backend chưa cài Daytona SDK. Hãy cài lại backend/requirements.txt."
        ) from error
    options: dict[str, Any] = {
        "api_key": settings.daytona_api_key,
        "otel_enabled": False,
    }
    if settings.daytona_api_url.strip():
        options["api_url"] = settings.daytona_api_url.strip()
    if settings.daytona_target.strip():
        options["target"] = settings.daytona_target.strip()
    return Daytona(DaytonaConfig(**options))


def _version_number(value: str) -> int:
    match = re.fullmatch(r"v(\d+)", value)
    return int(match.group(1)) if match else -1


def _snapshots(db: Session, project: Project) -> tuple[tuple[str, dict[str, str]] | None, tuple[str, dict[str, str]]]:
    current = {
        item.path: item.content
        for item in db.query(SourceFile)
        .filter(SourceFile.project_id == project.id)
        .order_by(SourceFile.path)
        .all()
    }
    if not current:
        raise PreviewError("Project chưa có mã nguồn để chạy xem trước.")
    versions = (
        db.query(CodeVersion)
        .filter(CodeVersion.project_id == project.id)
        .order_by(CodeVersion.created_at, CodeVersion.id)
        .all()
    )
    older = [item for item in versions if item.version != project.current_version]
    previous = max(
        older,
        key=lambda item: (_version_number(item.version), item.created_at, item.id),
        default=None,
    )
    before = None
    if previous is not None:
        try:
            snapshot = json.loads(previous.snapshot_json)
        except (TypeError, ValueError) as error:
            raise PreviewError("Không đọc được phiên bản mã nguồn trước đó.") from error
        if not isinstance(snapshot, dict) or not all(
            isinstance(path, str) and isinstance(content, str)
            for path, content in snapshot.items()
        ):
            raise PreviewError("Phiên bản mã nguồn trước đó không hợp lệ.")
        before = (previous.version, snapshot)
    return before, (project.current_version, current)


def _validate_files(files: dict[str, str]) -> None:
    settings = get_settings()
    if len(files) > settings.preview_max_files:
        raise PreviewError(
            f"Bản xem trước vượt giới hạn {settings.preview_max_files} tệp."
        )
    total = sum(len(content.encode("utf-8")) for content in files.values())
    if total > settings.preview_max_bytes:
        raise PreviewError("Bản xem trước vượt giới hạn dung lượng 10 MB.")
    try:
        if any(safe_upload_path(path) != path for path in files):
            raise PreviewError("Project có đường dẫn tệp không an toàn.")
    except ValueError as error:
        raise PreviewError("Project có đường dẫn tệp không an toàn.") from error


def _result_text(result: Any) -> str:
    return str(getattr(result, "result", "") or "")[-4000:]


def _wait_until_ready(url: str, timeout_seconds: int) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error = ""
    with httpx.Client(follow_redirects=True, timeout=5) as client:
        while time.monotonic() < deadline:
            try:
                response = client.get(url)
                if response.status_code < 500:
                    return
                last_error = f"HTTP {response.status_code}"
            except httpx.HTTPError as error:
                last_error = str(error)
            time.sleep(1)
    detail = f" ({last_error})" if last_error else ""
    raise PreviewError(
        "Ứng dụng chưa mở được cổng xem trước trong thời gian cho phép"
        f"{detail}. Kiểm tra lệnh chạy và log của project."
    )


def _create_target(
    client: Any,
    *,
    project: Project,
    label: str,
    version: str,
    files: dict[str, str],
    runtime: str,
    install_command: str,
    start_command: str,
    port: int,
) -> tuple[Any, dict[str, str]]:
    try:
        from daytona import (
            CreateSandboxFromSnapshotParams,
            FileUpload,
            SessionExecuteRequest,
        )
    except ImportError as error:
        raise PreviewUnavailable(
            "Backend chưa cài Daytona SDK. Hãy cài lại backend/requirements.txt."
        ) from error

    settings = get_settings()
    _validate_files(files)
    sandbox = client.create(
        CreateSandboxFromSnapshotParams(
            language=runtime,
            name=f"sentinel-{label}-{uuid4().hex[:8]}",
            labels={"app": "sentinel", "project": project.id, "version": version},
            public=False,
            ephemeral=True,
            ttl_minutes=settings.preview_ttl_minutes,
        ),
        timeout=settings.preview_create_timeout_seconds,
    )
    try:
        work_dir = sandbox.get_work_dir()
        uploads = [
            FileUpload(content.encode("utf-8"), f"{work_dir}/{path}")
            for path, content in sorted(files.items())
        ]
        sandbox.fs.upload_files(uploads, timeout=settings.preview_command_timeout_seconds)
        if install_command.strip():
            installed = sandbox.process.exec(
                install_command.strip(),
                cwd=work_dir,
                timeout=settings.preview_command_timeout_seconds,
            )
            if installed.exit_code != 0:
                raise PreviewError(
                    "Lệnh cài đặt thất bại:\n" + (_result_text(installed) or "Không có log.")
                )
        session_id = f"sentinel-preview-{uuid4().hex[:10]}"
        sandbox.process.create_session(session_id)
        started = sandbox.process.execute_session_command(
            session_id,
            SessionExecuteRequest(
                command=f"cd {shlex.quote(work_dir)} && {start_command.strip()}",
                run_async=True,
            ),
            timeout=15,
        )
        if started.exit_code not in (None, 0):
            output = (started.stderr or started.stdout or started.output or "")[-4000:]
            raise PreviewError("Không khởi động được ứng dụng:\n" + output)
        preview = sandbox.create_signed_preview_url(
            port,
            expires_in_seconds=settings.preview_ttl_minutes * 60,
        )
        _wait_until_ready(preview.url, settings.preview_start_timeout_seconds)
        return sandbox, {
            "label": label,
            "version": version,
            "url": preview.url,
        }
    except Exception:
        try:
            client.delete(sandbox, timeout=30)
        except Exception:
            pass
        raise


def create_comparison(
    db: Session,
    project: Project,
    *,
    runtime: str,
    install_command: str,
    start_command: str,
    port: int,
) -> dict[str, Any]:
    if runtime not in {"python", "javascript", "typescript"}:
        raise PreviewError("Runtime xem trước không được hỗ trợ.")
    if not start_command.strip():
        raise PreviewError("Lệnh chạy ứng dụng không được để trống.")
    if not 1024 <= port <= 65535:
        raise PreviewError("Cổng xem trước phải nằm trong khoảng 1024–65535.")

    before, after = _snapshots(db, project)
    stop_project_previews(project.id)
    client = _daytona_client()
    sandboxes: list[Any] = []
    try:
        before_result = None
        if before is not None:
            sandbox, before_result = _create_target(
                client,
                project=project,
                label="before",
                version=before[0],
                files=before[1],
                runtime=runtime,
                install_command=install_command,
                start_command=start_command,
                port=port,
            )
            sandboxes.append(sandbox)
        sandbox, after_result = _create_target(
            client,
            project=project,
            label="after",
            version=after[0],
            files=after[1],
            runtime=runtime,
            install_command=install_command,
            start_command=start_command,
            port=port,
        )
        sandboxes.append(sandbox)
    except PreviewError:
        for item in sandboxes:
            try:
                client.delete(item, timeout=30)
            except Exception:
                pass
        raise
    except Exception as error:
        for item in sandboxes:
            try:
                client.delete(item, timeout=30)
            except Exception:
                pass
        raise PreviewUnavailable(
            "Không tạo được Daytona sandbox. Kiểm tra API key, hạn mức và kết nối mạng."
        ) from error

    session_id = f"preview_{uuid4().hex}"
    with _sessions_lock:
        _sessions[session_id] = _LivePreview(project.id, client, sandboxes)
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=get_settings().preview_ttl_minutes
    )
    return {
        "sessionId": session_id,
        "provider": "Daytona",
        "expiresAt": expires_at,
        "before": before_result,
        "after": after_result,
    }


def stop_comparison(project_id: str, session_id: str) -> None:
    with _sessions_lock:
        live = _sessions.get(session_id)
        if live is None:
            return
        if live.project_id != project_id:
            raise PreviewError("Phiên xem trước không còn hoạt động.")
        _sessions.pop(session_id, None)
    for sandbox in live.sandboxes:
        try:
            live.client.delete(sandbox, timeout=30)
        except Exception:
            pass


def stop_project_previews(project_id: str) -> None:
    with _sessions_lock:
        ids = [key for key, value in _sessions.items() if value.project_id == project_id]
    for session_id in ids:
        try:
            stop_comparison(project_id, session_id)
        except PreviewError:
            pass


def cleanup_all() -> None:
    with _sessions_lock:
        items = list(_sessions.items())
        _sessions.clear()
    for _, live in items:
        for sandbox in live.sandboxes:
            try:
                live.client.delete(sandbox, timeout=15)
            except Exception:
                pass
