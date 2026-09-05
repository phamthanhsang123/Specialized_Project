import ast
import json
import zipfile
from io import BytesIO

import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session

from app.database import Base
from app.models import CodeVersion, FixProposal, Issue, Project, ReviewHistory, SourceFile, ensure_schema_compatibility
from app.services.source import (
    apply_accepted_fixes, create_snapshot, extract_python_files, issue_to_out,
    replace_project_files, review_issue, rollback_project, scan_file, scan_project,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enforce_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        yield session
    engine.dispose()


def project_with_source(db, files=None):
    project = Project(name="Integrity regression", current_version="v1")
    db.add(project)
    db.flush()
    for path, content in (files or {"sample.py": "def divide(a, b):\n    return a / b\n"}).items():
        db.add(SourceFile(project=project, path=path, content=content, size_bytes=len(content.encode())))
    db.flush()
    create_snapshot(db, project)
    db.commit()
    return project


def accept_all(db, project):
    issues = scan_project(db, project)
    for issue in issues:
        if issue.proposal:
            review_issue(db, issue, "ACCEPTED")
    db.commit()
    return issues


def test_scan_multiple_projects_and_rescan_no_id_collisions(db):
    first = project_with_source(db)
    second = project_with_source(db)
    first_ids = {issue.id for issue in scan_project(db, first)}
    second_ids = {issue.id for issue in scan_project(db, second)}
    db.commit()
    assert first_ids.isdisjoint(second_ids)
    again_ids = {issue.id for issue in scan_project(db, first)}
    db.commit()
    assert again_ids.isdisjoint(first_ids)
    assert db.query(Issue).count() == 2
    assert db.query(FixProposal).count() == 2
    assert all(issue_to_out(issue).confidence is None for issue in first.issues)


def test_upload_after_scan_removes_references_but_keeps_versions(db):
    project = project_with_source(db)
    accept_all(db, project)
    assert db.query(ReviewHistory).count() == 1
    replace_project_files(db, project, {"new.py": "value = 7\n"})
    db.commit()
    assert db.query(Issue).count() == db.query(FixProposal).count() == db.query(ReviewHistory).count() == 0
    assert [file.path for file in project.files] == ["new.py"]
    assert project.current_version == "v2"
    assert {version.version for version in project.versions} == {"v1", "v2"}
    assert "sample.py" in json.loads(next(version for version in project.versions if version.version == "v1").snapshot_json)


def test_apply_nested_rules_generates_valid_python_and_is_idempotent(db):
    project = project_with_source(db, {"sample.py": (
        "def configure(a, b):\n"
        '    API_KEY = "test-key"\n'
        "    try:\n"
        "        return a / b\n"
        "    except:\n"
        "        return None\n"
    )})
    issues = accept_all(db, project)
    assert len(issues) == 3
    assert apply_accepted_fixes(db, project) == 3
    db.commit()
    source = project.files[0].content
    ast.parse(source)
    assert "    import os\n" in source
    assert "        if b == 0:\n            raise ValueError" in source
    assert "    except Exception:" in source
    assert all(issue.status == "APPLIED" for issue in issues)
    assert apply_accepted_fixes(db, project) == 0
    assert project.current_version == "v2"
    assert not scan_file(project.files[0])


def test_patch_matches_selected_line_not_first_identical_text(db):
    original = "def first(a, b):\n    return a / b\n\ndef second(a, b):\n    return a / b\n"
    project = project_with_source(db, {"sample.py": original})
    issues = scan_project(db, project)
    second = max(issues, key=lambda issue: issue.line_start)
    review_issue(db, second, "ACCEPTED")
    db.commit()
    assert apply_accepted_fixes(db, project) == 1
    source = project.files[0].content
    assert source.startswith("def first(a, b):\n    return a / b\n")
    assert "def second(a, b):\n    if b == 0:" in source


def test_atomic_apply_rejects_stale_without_partial_changes(db):
    project = project_with_source(db, {"a.py": "def a(x, y):\n    return x / y\n",
                                       "b.py": "def b(x, y):\n    return x / y\n"})
    issues = accept_all(db, project)
    files = sorted(project.files, key=lambda file: file.path)
    files[1].content += "# changed after scan\n"
    db.commit()
    before = {file.path: file.content for file in files}
    with pytest.raises(ValueError, match="source changed"):
        apply_accepted_fixes(db, project)
    assert {file.path: file.content for file in files} == before
    assert all(issue.status == "ACCEPTED" for issue in issues)
    assert project.current_version == "v1"
    assert db.query(CodeVersion).count() == 1


def test_atomic_apply_rejects_invalid_python_and_no_op(db):
    project = project_with_source(db)
    [issue] = accept_all(db, project)
    original = project.files[0].content
    issue.proposal.replacement_code = "this is not valid python !!!"
    db.commit()
    with pytest.raises(ValueError, match="Patch rejected"):
        apply_accepted_fixes(db, project)
    assert project.files[0].content == original
    assert issue.status == "ACCEPTED"
    issue.proposal.replacement_code = issue.proposal.original_code
    db.commit()
    with pytest.raises(ValueError, match="does not change"):
        apply_accepted_fixes(db, project)
    assert issue.status == "ACCEPTED"
    assert project.current_version == "v1"


def test_rollback_creates_new_version_and_preserves_history(db):
    project = project_with_source(db)
    before = project.files[0].content
    accept_all(db, project)
    apply_accepted_fixes(db, project)
    db.commit()
    assert project.current_version == "v2"
    restored = rollback_project(db, project, "v1")
    db.commit()
    assert restored.version == project.current_version == "v3"
    assert project.files[0].content == before
    assert db.query(Issue).count() == 0
    assert {version.version for version in project.versions} == {"v1", "v2", "v3"}
    accept_all(db, project)
    apply_accepted_fixes(db, project)
    db.commit()
    assert project.current_version == "v4"
    restored = rollback_project(db, project)
    db.commit()
    assert restored.version == "v5"
    assert project.files[0].content == before


def test_rules_ignore_comments_and_sql_has_no_unsafe_fix(db):
    project = project_with_source(db, {"sample.py": (
        '# PASSWORD = "not code"\n'
        'query = "SELECT * FROM users WHERE id = " + user_id\n'
    )})
    [issue] = scan_project(db, project)
    assert issue.rule_code == "B608"
    assert issue.proposal is None
    with pytest.raises(ValueError, match="manual fix"):
        review_issue(db, issue, "ACCEPTED")
    review_issue(db, issue, "REJECTED")


def test_existing_import_and_shadowed_os_are_handled_conservatively():
    file = SourceFile(path="sample.py", content='import os\n\ndef f():\n    TOKEN = "a"\n')
    [issue] = scan_file(file)
    assert issue.replacement_code == '    TOKEN = os.environ["TOKEN"]'
    file.content = 'def f(os):\n    TOKEN = "a"\n'
    [issue] = scan_file(file)
    assert issue.replacement_code is None
    file.content = 'TOKEN = "a"\nimport os\n'
    [issue] = scan_file(file)
    assert issue.replacement_code.startswith("import os\n")
    file.content = 'import other_module as os\nTOKEN = "a"\n'
    [issue] = scan_file(file)
    assert issue.replacement_code is None


def test_apply_rejects_python_that_parses_but_cannot_compile(db):
    project = project_with_source(db, {"sample.py": 'TOKEN = "a"\n'})
    [issue] = accept_all(db, project)
    issue.proposal.replacement_code = "return 1"
    db.commit()
    with pytest.raises(ValueError, match="outside function"):
        apply_accepted_fixes(db, project)
    assert project.current_version == "v1"


def test_overlapping_proposals_are_rejected(db):
    project = project_with_source(db)
    [issue] = accept_all(db, project)
    duplicate = Issue(id="other-issue", project=project, file=issue.file, issue_type=issue.issue_type,
                      rule_code=issue.rule_code, severity=issue.severity, description=issue.description,
                      explanation=issue.explanation, impact=issue.impact, line_start=issue.line_start,
                      line_end=issue.line_end, confidence=0.0, status="ACCEPTED")
    db.add(duplicate)
    db.add(FixProposal(issue=duplicate, original_code=issue.proposal.original_code,
                       replacement_code=issue.proposal.replacement_code, diff="", reason="Test overlap",
                       base_source_hash=issue.proposal.base_source_hash))
    db.commit()
    with pytest.raises(ValueError, match="overlapping"):
        apply_accepted_fixes(db, project)
    assert project.current_version == "v1"


@pytest.mark.parametrize("path", ["../bad.py", "ok/../../bad.py", "/bad.py", "C:\\bad.py", "ok/./bad.py"])
def test_upload_rejects_unsafe_paths(path):
    with pytest.raises(ValueError, match="Invalid upload path"):
        extract_python_files(path, b"pass\n")


def test_upload_rejects_bad_zip_and_invalid_encoding():
    with pytest.raises(ValueError, match="valid ZIP"):
        extract_python_files("bad.zip", b"not zip")
    with pytest.raises(ValueError, match="UTF-8"):
        extract_python_files("bad.py", b"\xff")
    content = BytesIO()
    with zipfile.ZipFile(content, "w") as archive:
        archive.writestr("nested/../bad.py", "pass")
    with pytest.raises(ValueError, match="Invalid upload path"):
        extract_python_files("bad.zip", content.getvalue())


@pytest.mark.parametrize(
    "path",
    [
        ("a/" * 255) + "main.py",
        "src/bad\nname.py",
        "src/trailing./main.py",
        "src/CON.py",
        f"src/{'a' * 256}.py",
        "src/" + chr(0x1F40D) * 128 + ".py",
    ],
    ids=["too-long", "control", "trailing-dot", "windows-reserved", "segment-too-long", "utf16-segment-too-long"],
)
def test_upload_rejects_nonportable_paths(path):
    with pytest.raises(ValueError, match="Invalid upload path"):
        extract_python_files(path, b"pass\n")


def test_upload_accepts_512_character_path_and_preserves_original_spelling():
    path = ("a/" * 252) + "bMain.py"
    assert len(path) == 512
    assert extract_python_files(path, b"pass\n") == {path: "pass\n"}


def test_replace_rejects_portable_path_collision_before_database_changes(db):
    project = project_with_source(db, {"existing.py": "original = True\n"})
    version = project.current_version
    with pytest.raises(ValueError, match="Duplicate upload path"):
        replace_project_files(db, project, {
            "src/caf\u00e9.py": "first = True\n",
            "src/cafe\u0301.py": "second = True\n",
        })
    assert project.current_version == version
    assert [(file.path, file.content) for file in project.files] == [("existing.py", "original = True\n")]


def test_migration_adds_fields_without_replacing_legacy_rows():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id VARCHAR(64) PRIMARY KEY, email VARCHAR(255))"))
        connection.execute(text("INSERT INTO users (id, email) VALUES ('old', 'old@example.test')"))
        connection.execute(text("CREATE TABLE fix_proposals (id VARCHAR(64) PRIMARY KEY)"))
    ensure_schema_compatibility(engine)
    ensure_schema_compatibility(engine)
    with engine.connect() as connection:
        row = connection.execute(text("SELECT id, email, is_active FROM users")).one()
        assert tuple(row) == ("old", "old@example.test", 1)
    assert "base_source_hash" in {column["name"] for column in inspect(engine).get_columns("fix_proposals")}
    engine.dispose()


def test_legacy_proposals_require_rescan(db):
    project = project_with_source(db)
    [issue] = scan_project(db, project)
    issue.proposal.base_source_hash = None
    db.commit()
    with pytest.raises(ValueError, match="bản cũ"):
        review_issue(db, issue, "ACCEPTED")
    issue.status = "ACCEPTED"
    with pytest.raises(ValueError, match="bản cũ"):
        apply_accepted_fixes(db, project)
    assert project.current_version == "v1"
