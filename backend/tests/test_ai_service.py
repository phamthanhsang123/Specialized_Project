import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Issue, Project, SourceFile
from app.services import ai


@pytest.fixture
def ai_db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as db:
        project = Project(name="AI project")
        db.add(project)
        db.flush()
        file = SourceFile(project_id=project.id, path="calc.py", content="def divide(a, b):\n    return a / b\n")
        db.add(file)
        db.commit()
        yield db, project, file
    engine.dispose()


def finding(**changes):
    result = {"filePath": "calc.py", "lineStart": 2, "lineEnd": 2, "type": "Division", "severity": "HIGH", "description": "zero", "explanation": "zero", "impact": "exception", "proposal": None}
    result.update(changes)
    return result


def test_ai_missing_configuration_is_explicit(monkeypatch):
    monkeypatch.setattr(ai, "configured", lambda: False)
    with pytest.raises(ai.AIUnavailable):
        ai._request_json("return JSON", {})


def test_ai_scan_persists_real_findings_and_safe_proposals(ai_db, monkeypatch):
    db, project, file = ai_db
    proposal = {"originalCode": "    return a / b", "replacementCode": "    if b == 0:\n        raise ValueError('zero')\n    return a / b", "reason": "validate"}
    monkeypatch.setattr(ai, "_request_json", lambda *_: {"issues": [finding(proposal=proposal)]})
    issues = ai.scan_with_ai(db, project)
    db.commit()
    assert len(issues) == 1 and issues[0].rule_code == "AI"
    assert issues[0].proposal.base_source_hash
    assert file.content == "def divide(a, b):\n    return a / b\n"
    assert issues[0].status == "PENDING"


def test_bad_ai_location_preserves_existing_results(ai_db, monkeypatch):
    db, project, _ = ai_db
    monkeypatch.setattr(ai, "_request_json", lambda *_: {"issues": [finding()]})
    previous = ai.scan_with_ai(db, project)[0]
    db.commit()
    monkeypatch.setattr(ai, "_request_json", lambda *_: {"issues": [finding(filePath="not-in-project.py")]})
    with pytest.raises(ai.AIOutputError):
        ai.scan_with_ai(db, project)
    assert db.query(Issue).one().id == previous.id


def test_invalid_patch_is_not_offered_as_safe(ai_db, monkeypatch):
    db, project, _ = ai_db
    proposal = {"originalCode": "    return a / b", "replacementCode": "return a / b", "reason": "bad indent"}
    monkeypatch.setattr(ai, "_request_json", lambda *_: {"issues": [finding(proposal=proposal)]})
    issue = ai.scan_with_ai(db, project)[0]
    assert issue.proposal is None
    assert "cú pháp" in issue.explanation


def test_ai_test_generation_validates_all_modules_before_saving(ai_db, monkeypatch):
    db, project, _ = ai_db
    monkeypatch.setattr(ai, "_request_json", lambda *_: {"tests": [{"name": "good", "code": "def test_ok(): assert True"}, {"name": "bad", "code": "def test_bad(:"}]})
    with pytest.raises(ai.AIOutputError):
        ai.generate_tests(db, project)
    from app.services.testing import list_test_cases
    assert list_test_cases(db, project) == []


def test_ai_generated_names_cannot_overwrite_manual_tests(ai_db, monkeypatch):
    import re
    from app.services.testing import save_test_case, list_test_cases
    db, project, _ = ai_db
    manual = save_test_case(db, project, 'test_calc.py', 'def test_manual(): assert True')
    monkeypatch.setattr(ai, '_request_json', lambda *_: {'tests': [{'name': 'test_calc.py', 'code': 'def test_generated(): assert True'}]})
    [generated] = ai.generate_tests(db, project)
    assert generated['id'] != manual['id']
    assert re.fullmatch(r'test_[A-Za-z0-9_]+\.py', generated['name'])
    assert next(case for case in list_test_cases(db, project) if case['id'] == manual['id'])['code'] == manual['code']


def test_null_provider_choice_is_reported_cleanly(monkeypatch):
    import httpx
    monkeypatch.setattr(ai, 'configured', lambda: True)
    response = httpx.Response(200, json={'choices': [None]}, request=httpx.Request('POST','https://provider.invalid/chat/completions'))
    monkeypatch.setattr(ai.httpx, 'post', lambda *args, **kwargs: response)
    with pytest.raises(ai.AIOutputError):
        ai._request_json('JSON', {})
