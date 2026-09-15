from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from evaluation.evaluate import evaluate, normalize_type, score_case


def test_type_aliases_are_normalized_for_fair_matching():
    assert normalize_type("Possible SQL Injection") == "SQL_INJECTION"
    assert normalize_type("weak input validation") == "INPUT_VALIDATION"
    assert normalize_type("off-by-one error") == "BOUNDARY_LOGIC"


def test_matching_uses_each_prediction_at_most_once():
    labels = [
        {"type": "SQL_INJECTION", "lineStart": 2, "lineEnd": 2, "severity": "CRITICAL"},
        {"type": "SQL_INJECTION", "lineStart": 2, "lineEnd": 2, "severity": "CRITICAL"},
    ]
    predictions = [{
        "filePath": "sample.py",
        "type": "SQL_INJECTION",
        "rawType": "SQL Injection",
        "lineStart": 2,
        "lineEnd": 2,
        "severity": "CRITICAL",
        "proposal": None,
    }]
    result = score_case(labels, predictions, "sample.py")
    assert len(result["matches"]) == 1
    assert len(result["missed"]) == 1
    assert result["extra"] == []


def test_static_baseline_is_reproducible():
    result = evaluate("static")
    assert result["caseCount"] == 20
    assert result["labelCount"] == 10
    assert result["metrics"] == {
        "truePositives": 4,
        "falsePositives": 0,
        "falseNegatives": 6,
        "precision": 1.0,
        "recall": 0.4,
        "f1": 0.5714,
        "severityAccuracy": 1.0,
        "proposalCount": 3,
        "proposalSyntaxValidRate": 1.0,
    }
