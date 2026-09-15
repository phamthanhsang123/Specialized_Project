import json
import sys
from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import CodeVersion, Project, SourceFile
from app.services import preview


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    preview.cleanup_all()
    engine.dispose()


def settings(**overrides):
    values = {
        "daytona_api_key": "test-key",
        "daytona_api_url": "https://example.invalid/api",
        "daytona_target": "",
        "preview_ttl_minutes": 30,
        "preview_create_timeout_seconds": 30,
        "preview_command_timeout_seconds": 60,
        "preview_start_timeout_seconds": 10,
        "preview_max_files": 500,
        "preview_max_bytes": 10 * 1024 * 1024,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class FakeFileSystem:
    def __init__(self):
        self.uploads = []

    def upload_files(self, uploads, timeout):
        self.uploads = uploads


class FakeProcess:
    def __init__(self):
        self.commands = []

    def exec(self, command, cwd=None, timeout=None):
        self.commands.append(("install", command, cwd))
        return SimpleNamespace(exit_code=0, result="installed")

    def create_session(self, session_id):
        self.commands.append(("session", session_id))

    def execute_session_command(self, session_id, request, timeout=None):
        self.commands.append(("start", session_id, request.command))
        return SimpleNamespace(exit_code=None, stderr="", stdout="", output="")


class FakeSandbox:
    def __init__(self, number):
        self.number = number
        self.fs = FakeFileSystem()
        self.process = FakeProcess()

    def get_work_dir(self):
        return "/workspace"

    def create_signed_preview_url(self, port, expires_in_seconds=None):
        return SimpleNamespace(url=f"https://preview.test/{self.number}/{port}")


class FakeClient:
    def __init__(self):
        self.created = []
        self.deleted = []

    def create(self, params, timeout=None):
        sandbox = FakeSandbox(len(self.created) + 1)
        self.created.append((sandbox, params, timeout))
        return sandbox

    def delete(self, sandbox, timeout=None):
        self.deleted.append(sandbox)


def install_fake_daytona(monkeypatch):
    class Params:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class Upload:
        def __init__(self, source, destination):
            self.source = source
            self.destination = destination

    class Request:
        def __init__(self, *, command, run_async):
            self.command = command
            self.run_async = run_async

    monkeypatch.setitem(
        sys.modules,
        "daytona",
        SimpleNamespace(
            CreateSandboxFromSnapshotParams=Params,
            FileUpload=Upload,
            SessionExecuteRequest=Request,
        ),
    )


def project_with_versions(db):
    project = Project(name="Web preview", current_version="v2")
    db.add(project)
    db.flush()
    db.add(SourceFile(project=project, path="app.py", content="print('after')\n", size_bytes=15))
    db.add(
        CodeVersion(
            project=project,
            version="v1",
            source_path="storage/v1",
            snapshot_json=json.dumps({"app.py": "print('before')\n"}),
            created_at=datetime(2026, 1, 1),
        )
    )
    db.add(
        CodeVersion(
            project=project,
            version="v2",
            source_path="storage/v2",
            snapshot_json=json.dumps({"app.py": "print('after')\n"}),
            created_at=datetime(2026, 1, 2),
        )
    )
    db.commit()
    return project


def test_comparison_runs_previous_and_current_versions(db, monkeypatch):
    project = project_with_versions(db)
    client = FakeClient()
    install_fake_daytona(monkeypatch)
    monkeypatch.setattr(preview, "get_settings", lambda: settings())
    monkeypatch.setattr(preview, "_daytona_client", lambda: client)
    monkeypatch.setattr(preview, "_wait_until_ready", lambda *_: None)

    result = preview.create_comparison(
        db,
        project,
        runtime="javascript",
        install_command="npm install",
        start_command="npm run dev -- --host 0.0.0.0",
        port=3000,
    )

    assert result["before"]["version"] == "v1"
    assert result["after"]["version"] == "v2"
    assert result["before"]["url"].endswith("/1/3000")
    assert len(client.created) == 2
    assert client.created[0][1].language == "javascript"
    assert client.created[0][0].fs.uploads[0].destination == "/workspace/app.py"
    assert b"before" in client.created[0][0].fs.uploads[0].source
    assert b"after" in client.created[1][0].fs.uploads[0].source

    replacement = preview.create_comparison(
        db,
        project,
        runtime="javascript",
        install_command="npm install",
        start_command="npm run dev -- --host 0.0.0.0",
        port=3000,
    )
    assert len(client.deleted) == 2
    preview.stop_comparison(project.id, replacement["sessionId"])
    assert len(client.deleted) == 4
    preview.stop_comparison(project.id, result["sessionId"])


def test_comparison_requires_daytona_key(db, monkeypatch):
    project = project_with_versions(db)
    monkeypatch.setattr(
        preview, "get_settings", lambda: settings(daytona_api_key="")
    )

    with pytest.raises(preview.PreviewUnavailable, match="DAYTONA_API_KEY"):
        preview.create_comparison(
            db,
            project,
            runtime="python",
            install_command="",
            start_command="python app.py",
            port=8000,
        )


def test_comparison_requires_a_start_command(db):
    project = project_with_versions(db)
    with pytest.raises(preview.PreviewError, match="không được để trống"):
        preview.create_comparison(
            db,
            project,
            runtime="javascript",
            install_command="",
            start_command=" ",
            port=3000,
        )
