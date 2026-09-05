import base64
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Issue, Project, SourceFile, TestResult as StoredTestResult
from app.services import testing


@pytest.fixture
def test_db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as db:
        project = Project(name="Sandbox project")
        db.add(project)
        db.flush()
        file = SourceFile(project_id=project.id, path="calc.py", content="def divide(a, b):\n    return a / b\n")
        db.add(file)
        db.flush()
        issue = Issue(id="issue", project_id=project.id, file_id=file.id, issue_type="Division", rule_code="B018", severity="HIGH", description="division", explanation="division", impact="division", line_start=2, line_end=2, status="APPLIED")
        db.add(issue)
        db.commit()
        yield db, project, issue
    engine.dispose()


def test_test_case_save_validates_code_without_executing(test_db):
    db, project, _ = test_db
    result = testing.save_test_case(db, project, "division", "from calc import divide\ndef test_divide():\n    assert divide(6, 2) == 3\n")
    assert result["id"]
    assert testing.list_test_cases(db, project) == [result]
    with pytest.raises(testing.TestingError):
        testing.save_test_case(db, project, "bad", "def broken(:")
    assert len(testing.list_test_cases(db, project)) == 1


def test_unavailable_docker_never_creates_fake_result(test_db, monkeypatch):
    db, project, issue = test_db
    testing.save_test_case(db, project, "test", "def test_value(): assert True")
    monkeypatch.setattr(testing.shutil, "which", lambda _: None)
    with pytest.raises(testing.SandboxUnavailable):
        testing.run_project_tests(db, project)
    assert db.query(StoredTestResult).count() == 0
    assert issue.status == "APPLIED"


@pytest.mark.parametrize("xml,code,status,passed", [
    (b'<testsuites><testsuite><testcase/><testcase/></testsuite></testsuites>', 0, "PASS", 2),
    (b'<testsuites><testsuite><testcase><failure/></testcase></testsuite></testsuites>', 1, "FAIL", 0),
    (b'<testsuites><testsuite><testcase><error/></testcase></testsuite></testsuites>', 2, "FAIL", 0),
    (b'<testsuites><testsuite><testcase><skipped/></testcase></testsuite></testsuites>', 0, "FAIL", 0),
    (b'<testsuites><testsuite><testcase/><testcase><skipped/></testcase></testsuite></testsuites>', 0, "FAIL", 1),
    (b'<testsuites/>', 5, "FAIL", 0),
    (b'<testsuites><testsuite><testcase/></testsuite></testsuites>', 137, "FAIL", 1),
])
def test_report_never_verifies_failed_empty_or_skipped_runs(xml, code, status, passed):
    result = testing._report(xml, code)
    assert result["status"] == status
    assert result["passed"] == passed


@pytest.mark.parametrize("path", ["../escape.py", "/tmp/out.py", "C:/escape.py", "src/../../out.py"])
def test_sandbox_paths_cannot_escape(tmp_path, path):
    with pytest.raises(testing.TestingError):
        testing._safe_file(tmp_path, path)


def test_container_protocol_limits_and_persisted_verification(test_db, monkeypatch):
    db, project, issue = test_db
    testing.save_test_case(db, project, "division", "def test_divide(): assert True")
    monkeypatch.setattr(testing.shutil, "which", lambda _: "docker")
    monkeypatch.setattr(testing, "get_settings", lambda: SimpleNamespace(sandbox_image="test-image", sandbox_memory="256m", sandbox_cpus=0.5, sandbox_timeout_seconds=10))
    calls = []

    def docker(args, timeout=15):
        calls.append(args)
        output = ""
        if args[0] == "info":
            output = "linux"
        if args[0] == "inspect":
            output = '{"ExitCode":0,"OOMKilled":false}'
        return SimpleNamespace(returncode=0, stdout=output, stderr="")

    monkeypatch.setattr(testing, "_docker", docker)
    report = base64.b64encode(b'<testsuites><testsuite><testcase/></testsuite></testsuites>').decode()
    monkeypatch.setattr(testing, "_attach", lambda *_: (0, "1 passed\n__SENTINEL_JUNIT_V1__=" + report, False))
    run = testing.run_project_tests(db, project)
    db.commit()
    assert run.status == "PASS" and run.passed == 1
    assert issue.status == "VERIFIED"
    assert "1 passed" in run.output
    command = next(call for call in calls if call[0] == "create")
    for flag in ["--network", "--read-only", "--cap-drop", "--security-opt", "--pids-limit", "--memory", "--cpus", "--user"]:
        assert flag in command
    assert command[command.index("--network") + 1] == "none"
    assert any(call[0] == "rm" for call in calls)
