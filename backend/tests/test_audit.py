import json

from app.models import AuditEvent, Issue, Project, ReviewHistory, ensure_schema_compatibility
from app.services.source import replace_project_files, review_issue, scan_project

from test_auth_api import auth_api, authenticate


def test_review_audit_survives_rollback_upload_and_rescan(auth_api):
    client, sessions, _ = auth_api
    _, developer_headers = authenticate(client)
    _, admin_headers = authenticate(client, "admin@example.com")
    endpoint = "/api/projects/alice-project"
    source = b"def divide(a, b):\n    return a / b\n"
    uploaded = client.post(endpoint + "/upload", headers=developer_headers, files={"file": ("main.py", source)})
    assert uploaded.status_code == 200, uploaded.text
    original_version = uploaded.json()["version"]
    scanned = client.post(endpoint + "/scan", headers=developer_headers)
    assert scanned.status_code == 200, scanned.text
    issue = scanned.json()["issues"][0]
    reviewed = client.post(f"/api/issues/{issue['id']}/accept", headers=developer_headers)
    assert reviewed.status_code == 200, reviewed.text
    applied = client.post(endpoint + "/apply", headers=developer_headers)
    assert applied.status_code == 200, applied.text
    restored = client.post(endpoint + "/rollback", params={"version": original_version}, headers=developer_headers)
    assert restored.status_code == 200, restored.text
    with sessions() as db:
        assert db.query(Issue).count() == 0
        assert db.query(ReviewHistory).count() == 0
        [event] = db.query(AuditEvent).filter(AuditEvent.action == "ACCEPTED").all()
        event_id = event.id
        assert event.actor_id == "alice"
        assert event.project_id == "alice-project"
        assert issue["id"] in event.detail
        assert issue["type"] in event.detail
    uploaded_again = client.post(endpoint + "/upload", headers=developer_headers,
                                 files={"file": ("main.py", b"result = 1\n")})
    assert uploaded_again.status_code == 200, uploaded_again.text
    assert client.post(endpoint + "/scan", headers=developer_headers).status_code == 200
    with sessions() as db:
        assert db.get(AuditEvent, event_id) is not None
    activities = client.get("/api/admin/overview", headers=admin_headers).json()["activities"]
    [activity] = [item for item in activities if item["id"] == event_id]
    assert activity["actorName"] == "Alice"
    assert activity["projectName"] == "Alice project"
    assert activity["action"] == "Chấp nhận đề xuất sửa"


def test_admin_user_changes_have_durable_actor_and_target_audit(auth_api):
    client, sessions, _ = auth_api
    _, admin_headers = authenticate(client, "admin@example.com")
    payload = {"fullName": "Audit Developer", "email": "audit@example.com", "password": "test-audit-password"}
    created = client.post("/api/admin/users", headers=admin_headers, json=payload)
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]
    assert client.post("/api/admin/users", headers=admin_headers, json=payload).status_code == 409
    for state in (False, False, True):
        response = client.patch(f"/api/admin/users/{user_id}", headers=admin_headers, json={"isActive": state})
        assert response.status_code == 200, response.text
    with sessions() as db:
        events = db.query(AuditEvent).order_by(AuditEvent.created_at).all()
        assert [event.action for event in events] == ["USER_CREATED", "USER_LOCKED", "USER_UNLOCKED"]
        assert all(event.actor_id == "admin" for event in events)
        assert all(json.loads(event.detail)["user_id"] == user_id for event in events)
        assert all("password" not in event.detail for event in events)
    overview = client.get("/api/admin/overview", headers=admin_headers).json()
    assert len(overview["activities"]) == 3
    assert all(event["actorName"] == "Admin" for event in overview["activities"])


def test_audit_backfill_preserves_legacy_reviews_and_does_not_duplicate_new_ones(auth_api):
    _, sessions, engine = auth_api
    with sessions() as db:
        project = db.get(Project, "alice-project")
        replace_project_files(db, project, {"main.py": "def divide(a, b):\n    return a / b\n"})
        [issue] = scan_project(db, project)
        legacy = ReviewHistory(issue_id=issue.id, action="REJECTED", reviewer_id="alice")
        db.add(legacy)
        db.commit()
        review_issue(db, issue, "ACCEPTED", reviewer_id="alice")
        db.commit()
    ensure_schema_compatibility(engine)
    ensure_schema_compatibility(engine)
    with sessions() as db:
        events = db.query(AuditEvent).all()
        assert len(events) == 2
        assert {event.action for event in events} == {"ACCEPTED", "REJECTED"}
        assert all(json.loads(event.detail)["review_id"] for event in events)
