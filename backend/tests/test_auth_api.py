from datetime import datetime, timedelta
from io import BytesIO
import zipfile

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.auth import bootstrap_admin, hash_password, token_hash, verify_password
from app.database import Base, get_db
from app.models import AuthSession, Project, User
from app.services.source import MAX_UPLOAD_BYTES, MAX_PYTHON_FILES


@pytest.fixture
def auth_api():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False)
    with sessions() as db:
        # Share the expensive derivation across fixture accounts, as only access differs here.
        password = hash_password("correct-password")
        db.add_all([
            User(id="admin", email="admin@example.com", full_name="Admin", role="admin", is_active=True, password_hash=password),
            User(id="alice", email="alice@example.com", full_name="Alice", role="developer", is_active=True, password_hash=password),
            User(id="bob", email="bob@example.com", full_name="Bob", role="developer", is_active=True, password_hash=password),
        ])
        db.flush()
        db.add_all([Project(id="alice-project", name="Alice project", owner_id="alice"), Project(id="bob-project", name="Bob project", owner_id="bob")])
        db.commit()

    def provide_db():
        with sessions() as db:
            yield db

    main.app.dependency_overrides[get_db] = provide_db
    # No lifespan: every test uses its own database, never the local working database.
    client = TestClient(main.app)
    yield client, sessions, engine
    client.close()
    main.app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def authenticate(client, email="alice@example.com", password="correct-password"):
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json(), {"Authorization": f"Bearer {response.json()['token']}"}


def test_login_password_session_expiry_and_logout(auth_api):
    client, sessions, _ = auth_api
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "absent@example.com", "password": "wrong"}).status_code == 401
    payload, headers = authenticate(client, " ALICE@EXAMPLE.COM ")
    assert payload["user"] == {"id": "alice", "email": "alice@example.com", "fullName": "Alice", "role": "developer", "isActive": True, "mustChangePassword": False}
    assert client.get("/api/auth/me", headers=headers).json() == payload["user"]
    with sessions() as db:
        session = db.query(AuthSession).one()
        assert session.token_hash == token_hash(payload["token"])
        assert payload["token"] not in session.token_hash
        assert db.get(User, "alice").password_hash != "correct-password"
        session.expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    _, headers = authenticate(client)
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    with sessions() as db:
        assert db.query(AuthSession).count() == 0


def test_owner_isolation_covers_project_and_issue_endpoints(auth_api):
    client, sessions, _ = auth_api
    _, alice_headers = authenticate(client)
    _, bob_headers = authenticate(client, "bob@example.com")
    _, admin_headers = authenticate(client, "admin@example.com")
    assert client.get("/api/capabilities").status_code == 401
    assert client.get("/api/capabilities", headers=alice_headers).status_code == 200
    for suffix in ("/ai-scan", "/test-cases/generate", "/test-runs/foreign-run/explain"):
        assert client.post(f"/api/projects/alice-project{suffix}").status_code == 401
        assert client.post(f"/api/projects/alice-project{suffix}", headers=bob_headers).status_code == 404
    assert client.post("/api/projects/bob-project/test-runs/nonexistent/explain", headers=bob_headers).status_code == 404
    for root in ("", "/api"):
        assert client.get(f"{root}/projects").status_code == 401
        assert [project["id"] for project in client.get(f"{root}/projects", headers=alice_headers).json()] == ["alice-project"]
        assert len(client.get(f"{root}/projects", headers=admin_headers).json()) == 2
        for suffix in ("", "/files", "/files/content?path=main.py", "/issues", "/versions", "/test-runs", "/test-results", "/test-cases"):
            assert client.get(f"{root}/projects/alice-project{suffix}", headers=bob_headers).status_code == 404
        for suffix in ("/scan", "/apply", "/test", "/rollback"):
            assert client.post(f"{root}/projects/alice-project{suffix}", headers=bob_headers).status_code == 404
        assert client.post(f"{root}/projects/alice-project/upload", headers=bob_headers, files={"file": ("main.py", b"print('blocked')\n")}).status_code == 404
        assert client.post(f"{root}/projects/alice-project/test-cases", headers=bob_headers, json={"name": "test_main.py", "code": "def test_main(): assert True"}).status_code == 404
    created = client.post("/api/projects", headers=alice_headers, json={"name": "New project"})
    assert created.status_code == 200
    with sessions() as db:
        assert db.get(Project, created.json()["id"]).owner_id == "alice"
    upload = client.post("/api/projects/alice-project/upload", headers=alice_headers, files={"file": ("main.py", b"def f():\n    try:\n        return 1\n    except:\n        return 0\n")})
    assert upload.status_code == 200, upload.text
    scanned = client.post("/api/projects/alice-project/scan", headers=alice_headers)
    assert scanned.status_code == 200, scanned.text
    issue_id = scanned.json()["issues"][0]["id"]
    for suffix in ("", "/proposal"):
        assert client.get(f"/api/issues/{issue_id}{suffix}", headers=bob_headers).status_code == 404
    for suffix in ("/accept", "/reject"):
        assert client.post(f"/api/issues/{issue_id}{suffix}", headers=bob_headers).status_code == 404
    assert client.post(f"/api/issues/{issue_id}/ai-proposal").status_code == 401
    assert client.post(f"/api/issues/{issue_id}/ai-proposal", headers=bob_headers).status_code == 404
    assert client.get(f"/api/issues/{issue_id}", headers=alice_headers).json()["issue"]["status"] == "PENDING"


def test_upload_accepts_multiple_python_files_and_preserves_relative_paths(auth_api):
    client, _, _ = auth_api
    _, headers = authenticate(client)
    response = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files=[
            ("file", ("src/main.py", b"from lib.maths import add\n", "text/x-python")),
            ("file", ("src/lib/maths.py", b"def add(a, b):\n    return a + b\n", "text/x-python")),
            ("file", ("tests/test_maths.py", b"def test_add():\n    assert 1 + 1 == 2\n", "text/x-python")),
        ],
    )
    assert response.status_code == 200, response.text
    assert [item["path"] for item in response.json()["files"]] == [
        "src/lib/maths.py", "src/main.py", "tests/test_maths.py",
    ]
    assert client.get(
        "/api/projects/alice-project/files/content",
        headers=headers,
        params={"path": "src/lib/maths.py"},
    ).json()["content"] == "def add(a, b):\n    return a + b\n"


def test_upload_keeps_legacy_single_upload_field(auth_api):
    client, _, _ = auth_api
    _, headers = authenticate(client)
    response = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files={"upload": ("legacy.py", b"value = 1\n", "text/x-python")},
    )
    assert response.status_code == 200, response.text
    assert [item["path"] for item in response.json()["files"]] == ["legacy.py"]


@pytest.mark.parametrize(
    ("files", "message"),
    [
        ([
            ("file", ("good.py", b"value = 1\n", "text/x-python")),
            ("file", ("../escape.py", b"value = 2\n", "text/x-python")),
        ], "Invalid upload path"),
        ([
            ("file", ("src\\same.py", b"value = 1\n", "text/x-python")),
            ("file", ("src/same.py", b"value = 2\n", "text/x-python")),
        ], "Duplicate upload path"),
        ([
            ("file", ("src/Module.py", b"value = 1\n", "text/x-python")),
            ("file", ("src/module.py", b"value = 2\n", "text/x-python")),
        ], "Duplicate upload path"),
        ([
            ("file", (("a/" * 255) + "main.py", b"value = 1\n", "text/x-python")),
        ], "Invalid upload path"),
        ([
            ("file", ("good.py", b"value = 1\n", "text/x-python")),
            ("file", ("README.txt", b"not Python", "text/plain")),
        ], "Only .py or .zip"),
        ([
            ("file", ("good.py", b"value = 1\n", "text/x-python")),
            ("file", ("broken.py", b"\xff", "text/x-python")),
        ], "UTF-8"),
    ],
    ids=["traversal", "separator-duplicate", "case-duplicate", "path-too-long", "unsupported-type", "invalid-utf8"],
)
def test_multi_file_upload_errors_leave_existing_project_unchanged(auth_api, files, message):
    client, _, _ = auth_api
    _, headers = authenticate(client)
    seeded = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files={"file": ("existing.py", b"original = True\n", "text/x-python")},
    )
    assert seeded.status_code == 200, seeded.text
    version = seeded.json()["version"]

    response = client.post("/api/projects/alice-project/upload", headers=headers, files=files)
    assert response.status_code == 400, response.text
    assert message in response.json()["detail"]
    assert client.get("/api/projects/alice-project", headers=headers).json()["version"] == version
    listed = client.get("/api/projects/alice-project/files", headers=headers).json()
    assert [item["path"] for item in listed] == ["existing.py"]
    content = client.get(
        "/api/projects/alice-project/files/content",
        headers=headers,
        params={"path": "existing.py"},
    ).json()["content"]
    assert content == "original = True\n"


def test_upload_rejects_empty_request_and_aggregate_raw_size(auth_api):
    client, _, _ = auth_api
    _, headers = authenticate(client)
    assert client.post("/api/projects/alice-project/upload", headers=headers).status_code == 400

    empty_zip = BytesIO()
    with zipfile.ZipFile(empty_zip, "w") as archive:
        archive.writestr("README.txt", "No Python source")
    response = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files={"file": ("empty.zip", empty_zip.getvalue(), "application/zip")},
    )
    assert response.status_code == 400, response.text
    assert "does not contain Python files" in response.json()["detail"]

    half_plus_one = MAX_UPLOAD_BYTES // 2 + 1
    response = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files=[
            ("file", ("one.py", b" " * half_plus_one, "text/x-python")),
            ("file", ("two.py", b" " * half_plus_one, "text/x-python")),
        ],
    )
    assert response.status_code == 413, response.text
    assert client.get("/api/projects/alice-project/files", headers=headers).json() == []
    assert client.get("/api/projects/alice-project", headers=headers).json()["version"] == "v1"


def test_upload_rejects_zip_bomb_and_too_many_python_files_atomically(auth_api):
    client, _, _ = auth_api
    _, headers = authenticate(client)

    oversized = BytesIO()
    with zipfile.ZipFile(oversized, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("oversized.py", b" " * (MAX_UPLOAD_BYTES + 1))
    response = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files={"file": ("oversized.zip", oversized.getvalue(), "application/zip")},
    )
    assert response.status_code == 400, response.text
    assert "10 MB extracted source" in response.json()["detail"]

    too_many = BytesIO()
    with zipfile.ZipFile(too_many, "w") as archive:
        for index in range(MAX_PYTHON_FILES + 1):
            archive.writestr(f"src/file_{index}.py", "pass\n")
    response = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files={"file": ("too-many.zip", too_many.getvalue(), "application/zip")},
    )
    assert response.status_code == 400, response.text
    assert "500 Python files" in response.json()["detail"]
    assert client.get("/api/projects/alice-project/files", headers=headers).json() == []
    assert client.get("/api/projects/alice-project", headers=headers).json()["version"] == "v1"


@pytest.mark.parametrize(
    "paths",
    [
        ("src/Module.py", "src/module.py"),
        ("src/caf\u00e9.py", "src/cafe\u0301.py"),
        (("a/" * 255) + "main.py",),
        ("src/bad\x01name.py",),
    ],
    ids=["case-collision", "unicode-collision", "path-too-long", "control-character"],
)
def test_invalid_zip_paths_leave_existing_project_unchanged(auth_api, paths):
    client, _, _ = auth_api
    _, headers = authenticate(client)
    seeded = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files={"file": ("existing.py", b"original = True\n", "text/x-python")},
    )
    assert seeded.status_code == 200, seeded.text
    version = seeded.json()["version"]

    content = BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        for path in paths:
            archive.writestr(path, "pass\n")
    response = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files={"file": ("invalid.zip", content.getvalue(), "application/zip")},
    )
    assert response.status_code == 400, response.text
    assert client.get("/api/projects/alice-project", headers=headers).json()["version"] == version
    listed = client.get("/api/projects/alice-project/files", headers=headers).json()
    assert [item["path"] for item in listed] == ["existing.py"]


def test_upload_rejects_more_than_500_multipart_files_atomically(auth_api):
    client, _, _ = auth_api
    _, headers = authenticate(client)
    seeded = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files={"file": ("existing.py", b"original = True\n", "text/x-python")},
    )
    assert seeded.status_code == 200, seeded.text
    version = seeded.json()["version"]

    response = client.post(
        "/api/projects/alice-project/upload",
        headers=headers,
        files=[
            ("file", (f"src/file_{index}.py", b"", "text/x-python"))
            for index in range(MAX_PYTHON_FILES + 1)
        ],
    )
    assert response.status_code == 400, response.text
    assert "500 Python files" in response.json()["detail"]
    assert client.get("/api/projects/alice-project", headers=headers).json()["version"] == version
    listed = client.get("/api/projects/alice-project/files", headers=headers).json()
    assert [item["path"] for item in listed] == ["existing.py"]


def test_admin_creates_persisted_developer_and_revokes_locked_sessions(auth_api):
    client, sessions, _ = auth_api
    _, admin_headers = authenticate(client, "admin@example.com")
    _, developer_headers = authenticate(client)
    assert client.get("/api/admin/overview", headers=developer_headers).status_code == 403
    assert client.post("/api/admin/users", headers=developer_headers, json={"fullName": "Forbidden", "email": "forbidden@example.com", "password": "new-password"}).status_code == 403
    created = client.post("/api/admin/users", headers=admin_headers, json={"fullName": "New Developer", "email": "NEW@example.com", "password": "new-password"})
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]
    assert created.json()["role"] == "developer"
    assert created.json()["email"] == "new@example.com"
    assert client.post("/api/admin/users", headers=admin_headers, json={"fullName": "Duplicate", "email": "new@example.com", "password": "new-password"}).status_code == 409
    _, new_headers = authenticate(client, "new@example.com", "new-password")
    locked = client.patch(f"/api/admin/users/{user_id}", headers=admin_headers, json={"isActive": False})
    assert locked.status_code == 200
    assert locked.json()["isActive"] is False
    assert client.get("/api/projects", headers=new_headers).status_code == 401
    assert client.post("/api/auth/login", json={"email": "new@example.com", "password": "new-password"}).status_code == 401
    assert client.patch(f"/api/admin/users/{user_id}", headers=admin_headers, json={"isActive": True}).status_code == 200
    assert client.get("/api/auth/me", headers=new_headers).status_code == 401
    authenticate(client, "new@example.com", "new-password")
    assert client.patch("/api/admin/users/admin", headers=admin_headers, json={"isActive": False}).status_code == 403
    overview = client.get("/api/admin/overview", headers=admin_headers).json()
    assert overview["metrics"]["users"] == 3
    assert overview["metrics"]["projects"] == 2
    assert overview["metrics"]["precision"] is None
    assert overview["metrics"]["recall"] is None
    assert overview["metrics"]["fixSuccessRate"] is None
    with sessions() as db:
        assert db.get(User, user_id).is_active is True


def test_seed_is_opt_in_and_idempotent(auth_api, monkeypatch):
    _, sessions, engine = auth_api
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main.settings, "seed_demo_data", False)
    monkeypatch.setattr(main.settings, "bootstrap_admin_email", None)
    monkeypatch.setattr(main.settings, "bootstrap_admin_password", None)
    main.ensure_schema_and_seed()
    with sessions() as db:
        assert db.query(User).count() == 3
        assert db.get(Project, "prj_001") is None
    monkeypatch.setattr(main.settings, "seed_demo_data", True)
    main.ensure_schema_and_seed()
    main.ensure_schema_and_seed()
    with sessions() as db:
        assert db.query(User).count() == 5
        developer = db.query(User).filter(User.email == "developer@sentinel.local").one()
        assert db.get(Project, "prj_001").owner_id == developer.id


def test_bootstrap_admin_requires_explicit_credentials_and_never_resets_existing_password(auth_api):
    _, sessions, _ = auth_api
    with sessions() as db:
        db.delete(db.get(User, "admin"))
        db.commit()
        bootstrap_admin(db, None, None)
        assert db.query(User).filter(User.role == "admin").count() == 0
        with pytest.raises(ValueError):
            bootstrap_admin(db, "first-admin@example.com", "short")
        bootstrap_admin(db, "first-admin@example.com", "configured-password")
        db.commit()
        bootstrap_admin(db, "first-admin@example.com", "changed-password")
        admin = db.query(User).filter(User.role == "admin").one()
        assert verify_password("configured-password", admin.password_hash)
        assert not verify_password("changed-password", admin.password_hash)
