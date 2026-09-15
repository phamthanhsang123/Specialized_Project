"""Đo Precision, Recall, F1 và chất lượng đề xuất trên bộ dữ liệu gán nhãn."""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND))

try:
    from .dataset import CASES, DATASET_VERSION  # type: ignore[import-not-found]
except ImportError:
    from dataset import CASES, DATASET_VERSION  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.models import SourceFile  # noqa: E402
from app.services.ai import (  # noqa: E402
    AIOutputError,
    AIUnavailable,
    FindingOutput,
    analyze_files_with_ai,
)
from app.services.source import scan_file  # noqa: E402


ALIASES = {
    "POSSIBLE_SQL_INJECTION": "SQL_INJECTION",
    "SQL_INJECTION": "SQL_INJECTION",
    "HARDCODED_SECRET": "HARDCODED_SECRET",
    "HARD_CODED_SECRET": "HARDCODED_SECRET",
    "POSSIBLE_DIVISION_BY_ZERO": "DIVISION_BY_ZERO",
    "DIVISION_BY_ZERO": "DIVISION_BY_ZERO",
    "BARE_EXCEPT": "BARE_EXCEPT",
    "BARE_EXCEPTION": "BARE_EXCEPT",
    "UNSAFE_INPUT": "INPUT_VALIDATION",
    "WEAK_INPUT_VALIDATION": "INPUT_VALIDATION",
    "INPUT_VALIDATION": "INPUT_VALIDATION",
    "NULL_HANDLING": "NULL_HANDLING",
    "NONE_HANDLING": "NULL_HANDLING",
    "RESOURCE_HANDLING": "RESOURCE_LEAK",
    "RESOURCE_LEAK": "RESOURCE_LEAK",
    "COMMAND_INJECTION": "COMMAND_INJECTION",
    "SHELL_INJECTION": "COMMAND_INJECTION",
    "PATH_TRAVERSAL": "PATH_TRAVERSAL",
    "DIRECTORY_TRAVERSAL": "PATH_TRAVERSAL",
    "OFF_BY_ONE": "BOUNDARY_LOGIC",
    "BOUNDARY_ERROR": "BOUNDARY_LOGIC",
    "BOUNDARY_LOGIC": "BOUNDARY_LOGIC",
}


def normalize_type(value: str) -> str:
    token = re.sub(r"[^A-Z0-9]+", "_", value.upper()).strip("_")
    if token in ALIASES:
        return ALIASES[token]
    if "SQL" in token and ("INJECT" in token or "QUERY" in token):
        return "SQL_INJECTION"
    if "DIVISION" in token and "ZERO" in token:
        return "DIVISION_BY_ZERO"
    if "SECRET" in token or "CREDENTIAL" in token:
        return "HARDCODED_SECRET"
    if "VALIDATION" in token or token == "UNSAFE_INPUT":
        return "INPUT_VALIDATION"
    if "NULL" in token or "NONE" in token:
        return "NULL_HANDLING"
    if "RESOURCE" in token or "UNCLOSED" in token:
        return "RESOURCE_LEAK"
    if "COMMAND" in token or "SHELL" in token:
        return "COMMAND_INJECTION"
    if "TRAVERSAL" in token:
        return "PATH_TRAVERSAL"
    if "BOUNDARY" in token or "OFF_BY_ONE" in token or "LOGIC" in token:
        return "BOUNDARY_LOGIC"
    return token or "UNKNOWN"


def prediction(
    *, path: str, issue_type: str, line_start: int, line_end: int,
    severity: str, proposal: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "filePath": path,
        "type": normalize_type(issue_type),
        "rawType": issue_type,
        "lineStart": line_start,
        "lineEnd": line_end,
        "severity": severity,
        "proposal": proposal,
    }


def run_static(case: dict[str, Any], path: str) -> list[dict[str, Any]]:
    source = case["source"]
    file = SourceFile(path=path, content=source, size_bytes=len(source.encode("utf-8")))
    return [
        prediction(
            path=path,
            issue_type=item.issue_type,
            line_start=item.line,
            line_end=item.line,
            severity=item.severity,
            proposal=(
                {
                    "originalCode": item.original_code,
                    "replacementCode": item.replacement_code,
                    "reason": item.reason,
                }
                if item.replacement_code is not None else None
            ),
        )
        for item in scan_file(file)
    ]


def run_ai(case: dict[str, Any], path: str) -> list[dict[str, Any]]:
    output = analyze_files_with_ai({path: case["source"]})
    return [prediction_from_ai(item) for item in output.issues]


def prediction_from_ai(item: FindingOutput) -> dict[str, Any]:
    return prediction(
        path=item.filePath,
        issue_type=item.type,
        line_start=item.lineStart,
        line_end=item.lineEnd,
        severity=item.severity,
        proposal=item.proposal.model_dump() if item.proposal else None,
    )


def proposal_compiles(source: str, item: dict[str, Any], path: str) -> bool:
    proposal = item.get("proposal")
    if not proposal:
        return False
    lines = source.splitlines(keepends=True)
    start, end = item["lineStart"], item["lineEnd"]
    if not 1 <= start <= end <= len(lines):
        return False
    original = "".join(lines[start - 1:end]).rstrip("\r\n")
    if original != proposal["originalCode"].rstrip("\r\n"):
        return False
    replacement = proposal["replacementCode"].rstrip("\r\n")
    if lines[end - 1].endswith("\n"):
        replacement += "\n"
    fixed = "".join(lines[:start - 1]) + replacement + "".join(lines[end:])
    try:
        compile(fixed, path, "exec")
    except SyntaxError:
        return False
    return fixed != source


def ranges_overlap(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return left["lineStart"] <= right["lineEnd"] and right["lineStart"] <= left["lineEnd"]


def score_case(
    labels: list[dict[str, Any]], predictions: list[dict[str, Any]], path: str,
) -> dict[str, Any]:
    gold = [{**item, "filePath": path, "type": normalize_type(item["type"])} for item in labels]
    unused = set(range(len(predictions)))
    matches: list[dict[str, Any]] = []
    missed: list[dict[str, Any]] = []
    for expected in gold:
        found = next(
            (
                index for index in unused
                if predictions[index]["filePath"] == expected["filePath"]
                and predictions[index]["type"] == expected["type"]
                and ranges_overlap(predictions[index], expected)
            ),
            None,
        )
        if found is None:
            missed.append(expected)
            continue
        unused.remove(found)
        actual = predictions[found]
        matches.append({
            "label": expected,
            "prediction": actual,
            "severityCorrect": actual["severity"] == expected["severity"],
        })
    return {
        "matches": matches,
        "missed": missed,
        "extra": [predictions[index] for index in sorted(unused)],
    }


def ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def evaluate(mode: str) -> dict[str, Any]:
    case_results = []
    type_counts: dict[str, dict[str, int]] = defaultdict(
        lambda: {"truePositives": 0, "falsePositives": 0, "falseNegatives": 0}
    )
    proposal_total = proposal_valid = severity_correct = 0
    for case in CASES:
        path = f'{case["id"]}.py'
        predictions = run_static(case, path) if mode == "static" else run_ai(case, path)
        scored = score_case(case["labels"], predictions, path)
        for matched in scored["matches"]:
            category = matched["label"]["type"]
            type_counts[category]["truePositives"] += 1
            severity_correct += int(matched["severityCorrect"])
        for missed in scored["missed"]:
            type_counts[missed["type"]]["falseNegatives"] += 1
        for extra in scored["extra"]:
            type_counts[extra["type"]]["falsePositives"] += 1
        for item in predictions:
            if item.get("proposal"):
                proposal_total += 1
                proposal_valid += int(proposal_compiles(case["source"], item, path))
        case_results.append({
            "id": case["id"],
            "labels": case["labels"],
            "predictions": predictions,
            "truePositives": len(scored["matches"]),
            "falsePositives": len(scored["extra"]),
            "falseNegatives": len(scored["missed"]),
        })

    true_positives = sum(item["truePositives"] for item in case_results)
    false_positives = sum(item["falsePositives"] for item in case_results)
    false_negatives = sum(item["falseNegatives"] for item in case_results)
    precision = ratio(true_positives, true_positives + false_positives)
    recall = ratio(true_positives, true_positives + false_negatives)
    f1 = (
        round(2 * precision * recall / (precision + recall), 4)
        if precision is not None and recall is not None and precision + recall else 0.0
    )
    per_type = {}
    for category, counts in sorted(type_counts.items()):
        category_precision = ratio(
            counts["truePositives"], counts["truePositives"] + counts["falsePositives"]
        )
        category_recall = ratio(
            counts["truePositives"], counts["truePositives"] + counts["falseNegatives"]
        )
        per_type[category] = {
            **counts,
            "precision": category_precision,
            "recall": category_recall,
        }
    model = get_settings().ai_model if mode == "ai" else None
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "datasetVersion": DATASET_VERSION,
        "mode": mode,
        "model": model,
        "caseCount": len(CASES),
        "labelCount": sum(len(case["labels"]) for case in CASES),
        "predictionCount": sum(len(item["predictions"]) for item in case_results),
        "metrics": {
            "truePositives": true_positives,
            "falsePositives": false_positives,
            "falseNegatives": false_negatives,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "severityAccuracy": ratio(severity_correct, true_positives),
            "proposalCount": proposal_total,
            "proposalSyntaxValidRate": ratio(proposal_valid, proposal_total),
        },
        "perType": per_type,
        "cases": case_results,
        "limitations": [
            "Bộ dữ liệu nhỏ do nhóm tự gán nhãn, chưa đại diện cho mọi dự án Python.",
            "Khớp phát hiện theo loại lỗi, tệp và vùng dòng giao nhau.",
            "Đề xuất đúng cú pháp chưa chứng minh bản sửa đúng hành vi.",
        ],
    }


def markdown_report(result: dict[str, Any]) -> str:
    metrics = result["metrics"]
    lines = [
        f'# Kết quả đánh giá {result["mode"]}',
        "",
        f'- Thời điểm UTC: `{result["generatedAt"]}`',
        f'- Phiên bản dữ liệu: `{result["datasetVersion"]}`',
        f'- Số mẫu: **{result["caseCount"]}**; số lỗi gán nhãn: **{result["labelCount"]}**',
        f'- Mô hình: `{result["model"] or "không dùng LLM"}`',
        "",
        "| Chỉ số | Giá trị |",
        "|---|---:|",
    ]
    for key in [
        "truePositives", "falsePositives", "falseNegatives", "precision", "recall",
        "f1", "severityAccuracy", "proposalCount", "proposalSyntaxValidRate",
    ]:
        lines.append(f"| {key} | {metrics[key] if metrics[key] is not None else 'N/A'} |")
    lines.extend(["", "| Loại lỗi | TP | FP | FN | Precision | Recall |", "|---|---:|---:|---:|---:|---:|"])
    for category, counts in result["perType"].items():
        category_precision = counts["precision"] if counts["precision"] is not None else "N/A"
        category_recall = counts["recall"] if counts["recall"] is not None else "N/A"
        lines.append(
            f'| {category} | {counts["truePositives"]} | {counts["falsePositives"]} | '
            f'{counts["falseNegatives"]} | {category_precision} | {category_recall} |'
        )
    lines.extend(["", "Các giới hạn:"])
    lines.extend(f'- {item}' for item in result["limitations"])
    return "\n".join(lines) + "\n"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    # Settings đọc backend/.env giống lúc chạy uvicorn từ thư mục backend.
    os.chdir(BACKEND)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["static", "ai"], default="static")
    parser.add_argument(
        "--output-prefix",
        type=Path,
        help="Đường dẫn không có phần mở rộng; mặc định lưu theo thời gian trong evaluation/results.",
    )
    args = parser.parse_args()
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    prefix = args.output_prefix or ROOT / "evaluation" / "results" / f"{args.mode}-{timestamp}"
    if not prefix.is_absolute():
        prefix = ROOT / prefix
    try:
        result = evaluate(args.mode)
    except (AIUnavailable, AIOutputError) as error:
        print(f"Không thể đánh giá AI: {error}", file=sys.stderr)
        return 2
    prefix.parent.mkdir(parents=True, exist_ok=True)
    prefix.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    prefix.with_suffix(".md").write_text(markdown_report(result), encoding="utf-8")
    print(markdown_report(result))
    print(f"Đã lưu: {prefix.with_suffix('.json')}")
    print(f"Đã lưu: {prefix.with_suffix('.md')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
