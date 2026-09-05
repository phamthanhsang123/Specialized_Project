import json
from datetime import datetime

from sqlalchemy import text, inspect
from app.models import User, AuditEvent, AuthSession, TestResult, CodeVersion, ensure_schema_compatibility
from app.auth import verify_password
from test_auth_api import auth_api, authenticate


def test_admin_edit_validates_email_and_keeps_ownership(auth_api):
    client, sessions, _ = auth_api
    _, headers = authenticate(client, "admin@example.com")
    duplicate = client.put("/api/admin/users/alice/profile", headers=headers, json={"fullName": "Alice", "email": " BOB@example.com "})
    assert duplicate.status_code == 409
    assert client.put("/api/admin/users/alice/profile", headers=headers, json={"fullName": "   ", "email": "new@example.com"}).status_code == 422
    response = client.put("/api/admin/users/alice/profile", headers=headers, json={"fullName": " Nguyễn Ánh ", "email": " NEW@example.com "})
    assert response.status_code == 200, response.text
    assert response.json()["fullName"] == "Nguyễn Ánh"
    assert response.json()["projectCount"] == 1
    assert response.json()["role"] == "developer"
    assert "password_hash" not in response.text
    with sessions() as db:
        event = db.query(AuditEvent).filter_by(action="USER_UPDATED").one()
        assert event.actor_id == "admin"
        assert json.loads(event.detail)["previous_email"] == "alice@example.com"
        assert db.get(User, "alice").email == "new@example.com"
    assert client.put("/api/admin/users/admin/profile", headers=headers, json={"fullName": "Admin", "email": "test@example.com"}).status_code == 403


def test_password_reset_revokes_sessions_and_forces_change_server_side(auth_api):
    client, sessions, _ = auth_api
    _, admin = authenticate(client, "admin@example.com")
    _, old_session = authenticate(client)
    _, other_session = authenticate(client)
    response = client.post("/api/admin/users/alice/reset-password", headers=admin, json={"temporaryPassword": "temporary-123"})
    assert response.status_code == 200, response.text
    assert response.json()["mustChangePassword"] is True
    for headers in (old_session, other_session):
        assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "correct-password"}).status_code == 401
    payload, temp = authenticate(client, password="temporary-123")
    assert payload["user"]["mustChangePassword"] is True
    assert client.get("/api/auth/me", headers=temp).status_code == 200
    for root in ("", "/api"):
        assert client.get(f"{root}/projects", headers=temp).status_code == 403
        assert client.post(f"{root}/projects/alice-project/scan", headers=temp).status_code == 403
    assert client.get("/api/capabilities", headers=temp).status_code == 403
    for current, new, expected in (("wrong", "private-123", 400), ("temporary-123", "temporary-123", 400), ("temporary-123", "short", 422)):
        assert client.post("/api/auth/change-password", headers=temp, json={"currentPassword": current, "newPassword": new}).status_code == expected
    assert client.post("/api/auth/change-password", headers=temp, json={"currentPassword": "temporary-123", "newPassword": "private-123"}).status_code == 200
    assert client.get("/api/auth/me", headers=temp).status_code == 401
    payload, current = authenticate(client, password="private-123")
    assert payload["user"]["mustChangePassword"] is False
    assert client.get("/api/projects", headers=current).status_code == 200
    with sessions() as db:
        assert verify_password("private-123", db.get(User, "alice").password_hash)
        assert db.query(AuthSession).filter_by(user_id="alice").count() == 1
        events = db.query(AuditEvent).all()
        assert {event.action for event in events} == {"PASSWORD_RESET", "PASSWORD_CHANGED"}
        for event in events:
            assert not any(secret in event.detail for secret in ("temporary-123", "private-123", "password_hash", "token"))


def test_lock_reason_and_reset_do_not_unlock_or_erase_data(auth_api):
    client, sessions, _ = auth_api
    _, admin = authenticate(client, "admin@example.com")
    assert client.patch("/api/admin/users/alice", headers=admin, json={"isActive": False, "reason": "  Tạm ngừng truy cập  "}).status_code == 200
    assert client.post("/api/admin/users/alice/reset-password", headers=admin, json={"temporaryPassword": "temporary-123"}).json()["isActive"] is False
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "temporary-123"}).status_code == 401
    assert client.patch("/api/admin/users/alice", headers=admin, json={"isActive": True}).json()["projectCount"] == 1
    with sessions() as db:
        assert json.loads(db.query(AuditEvent).filter_by(action="USER_LOCKED").one().detail)["reason"] == "Tạm ngừng truy cập"


def test_admin_metadata_has_latest_test_without_code_or_output(auth_api):
    client, sessions, _ = auth_api
    _, admin = authenticate(client, "admin@example.com")
    with sessions() as db:
        db.add(TestResult(id="test-1", project_id="alice-project", version="v1", status="PASS", total=3, passed=3, failed=0, errors=0, duration="1s", output="PRIVATE OUTPUT"))
        db.commit()
    result = client.get("/api/admin/projects/alice-project", headers=admin)
    assert result.status_code == 200, result.text
    assert result.json()["latestTest"]["passed"] == 3
    assert result.json()["ownerName"] == "Alice"
    assert "PRIVATE OUTPUT" not in result.text
    assert "files" not in result.json()
    assert client.get("/api/admin/projects/bob-project", headers=admin).json()["latestTest"] is None
    assert client.get("/api/admin/projects/missing", headers=admin).status_code == 404


def test_activity_filters_before_pagination_and_preserves_legacy_records(auth_api):
    client, sessions, _ = auth_api
    _, admin = authenticate(client, "admin@example.com")
    with sessions() as db:
        for index in range(25):
            db.add(AuditEvent(id=f"event-{index:02}", actor_id="admin", action="USER_UPDATED", created_at=datetime(2026, 9, 1, 12), detail=json.dumps({"email": "alice@example.com", "password": "SECRET", "token": "SECRET"})))
        db.add(AuditEvent(id="other", actor_id="alice", action="PASSWORD_CHANGED", created_at=datetime(2026, 9, 2)))
        db.add(AuditEvent(id="legacy", actor_id="seed", action="LEGACY", created_at=datetime(2026, 9, 2)))
        db.add(CodeVersion(id="version-1", project_id="alice-project", version="v1", source_path="private", snapshot_json="{}", created_by="alice", created_at=datetime(2026, 9, 2)))
        db.add(TestResult(id="test-1", project_id="alice-project", version="v1", status="PASS", total=1, passed=1, failed=0, errors=0, duration="1s", created_at=datetime(2026, 9, 2)))
        db.commit()
    params = {"actor_id": "admin", "action": "USER_UPDATED", "page": 2, "page_size": 10, "date_from": "2026-09-01T00:00:00Z", "date_to": "2026-09-02T00:00:00Z"}
    result = client.get("/api/admin/activities", headers=admin, params=params)
    assert result.status_code == 200, result.text
    assert result.json()["total"] == 25
    assert len(result.json()["items"]) == 10
    assert result.json()["items"][0]["id"] == "event-14"
    assert "SECRET" not in result.text
    legacy = client.get("/api/admin/activities", headers=admin, params={"action": "VERSION_SAVED"}).json()
    assert legacy["items"][0]["detail"] == {"version": "v1"}
    assert client.get("/api/admin/activities", headers=admin, params={"actor_id": "system"}).json()["total"] == 2
    assert client.get("/api/admin/activities", headers=admin, params={"date_from": "2026-09-02T00:00:00Z", "date_to": "2026-09-01T00:00:00Z"}).status_code == 422
    assert client.get("/api/admin/activities", headers=admin, params={"page": 0}).status_code == 422


def test_new_routes_enforce_roles_and_admin_cannot_modify_code(auth_api):
    client, _, _ = auth_api
    _, alice = authenticate(client)
    _, admin = authenticate(client, "admin@example.com")
    for endpoint in ("/admin/activities", "/admin/projects/alice-project"):
        assert client.get("/api" + endpoint, headers=alice).status_code == 403
        assert client.get("/api" + endpoint).status_code == 401
    assert client.put("/api/admin/users/bob/profile", headers=alice, json={"fullName": "Bob", "email": "b@example.com"}).status_code == 403
    assert client.post("/api/admin/users/bob/reset-password", headers=alice, json={"temporaryPassword": "temporary-123"}).status_code == 403
    for root in ("", "/api"):
        for endpoint in ("/projects/alice-project/scan", "/projects/alice-project/apply", "/projects/alice-project/rollback", "/issues/missing/accept", "/projects/alice-project/test"):
            assert client.post(root + endpoint, headers=admin).status_code == 403
    assert client.post("/api/projects/alice-project/ai-scan", headers=admin).status_code == 403


def test_additive_password_flag_migration_is_repeatable(auth_api):
    _, sessions, engine = auth_api
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users DROP COLUMN must_change_password"))
    ensure_schema_compatibility(engine)
    ensure_schema_compatibility(engine)
    assert "must_change_password" in {column["name"] for column in inspect(engine).get_columns("users")}
    with sessions() as db:
        assert db.query(User).count() == 3
        assert db.get(User, "alice").must_change_password is False
