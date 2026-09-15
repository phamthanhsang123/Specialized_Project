"""Bộ dữ liệu nhỏ có gán nhãn để kiểm tra quy trình đánh giá AI."""

DATASET_VERSION = "1.0"

CASES = [
    {
        "id": "sql-injection-positive",
        "source": '''import sqlite3

def find_user(connection, username):
    query = "SELECT * FROM users WHERE username = '" + username + "'"
    return connection.execute(query).fetchone()
''',
        "labels": [{"type": "SQL_INJECTION", "lineStart": 4, "lineEnd": 4, "severity": "CRITICAL"}],
    },
    {
        "id": "sql-injection-negative",
        "source": '''def find_user(connection, username):
    query = "SELECT * FROM users WHERE username = ?"
    return connection.execute(query, (username,)).fetchone()
''',
        "labels": [],
    },
    {
        "id": "hardcoded-secret-positive",
        "source": '''API_KEY = "benchmark_fake_key_not_a_real_secret"

def authorization_header():
    return {"Authorization": "Bearer " + API_KEY}
''',
        "labels": [{"type": "HARDCODED_SECRET", "lineStart": 1, "lineEnd": 1, "severity": "CRITICAL"}],
    },
    {
        "id": "hardcoded-secret-negative",
        "source": '''import os

API_KEY = os.environ["API_KEY"]

def authorization_header():
    return {"Authorization": "Bearer " + API_KEY}
''',
        "labels": [],
    },
    {
        "id": "division-by-zero-positive",
        "source": '''def average(total, count):
    return total / count
''',
        "labels": [{"type": "DIVISION_BY_ZERO", "lineStart": 2, "lineEnd": 2, "severity": "HIGH"}],
    },
    {
        "id": "division-by-zero-negative",
        "source": '''def average(total, count):
    if count == 0:
        raise ValueError("count must not be zero")
    return total / count
''',
        "labels": [],
    },
    {
        "id": "bare-except-positive",
        "source": '''def parse_number(value):
    try:
        return int(value)
    except:
        return None
''',
        "labels": [{"type": "BARE_EXCEPT", "lineStart": 4, "lineEnd": 4, "severity": "MEDIUM"}],
    },
    {
        "id": "bare-except-negative",
        "source": '''def parse_number(value):
    try:
        return int(value)
    except ValueError:
        return None
''',
        "labels": [],
    },
    {
        "id": "input-validation-positive",
        "source": '''def withdraw(balance, amount):
    """Amount must be positive and must not exceed the balance."""
    return balance - amount
''',
        "labels": [{"type": "INPUT_VALIDATION", "lineStart": 3, "lineEnd": 3, "severity": "HIGH"}],
    },
    {
        "id": "input-validation-negative",
        "source": '''def withdraw(balance, amount):
    if amount <= 0:
        raise ValueError("amount must be positive")
    if amount > balance:
        raise ValueError("insufficient balance")
    return balance - amount
''',
        "labels": [],
    },
    {
        "id": "null-handling-positive",
        "source": '''def display_name(user):
    return user.get("name").upper()
''',
        "labels": [{"type": "NULL_HANDLING", "lineStart": 2, "lineEnd": 2, "severity": "MEDIUM"}],
    },
    {
        "id": "null-handling-negative",
        "source": '''def display_name(user):
    name = user.get("name")
    return name.upper() if isinstance(name, str) else ""
''',
        "labels": [],
    },
    {
        "id": "resource-leak-positive",
        "source": '''def read_config(path):
    handle = open(path, encoding="utf-8")
    return handle.read()
''',
        "labels": [{"type": "RESOURCE_LEAK", "lineStart": 2, "lineEnd": 2, "severity": "MEDIUM"}],
    },
    {
        "id": "resource-leak-negative",
        "source": '''def read_config(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()
''',
        "labels": [],
    },
    {
        "id": "command-injection-positive",
        "source": '''import subprocess

def run_report(command):
    return subprocess.run(command, shell=True, check=True)
''',
        "labels": [{"type": "COMMAND_INJECTION", "lineStart": 4, "lineEnd": 4, "severity": "CRITICAL"}],
    },
    {
        "id": "command-injection-negative",
        "source": '''import subprocess

def run_report(report_name):
    if not report_name.replace("-", "").isalnum():
        raise ValueError("invalid report name")
    return subprocess.run(["report-tool", "--name", report_name], check=True)
''',
        "labels": [],
    },
    {
        "id": "path-traversal-positive",
        "source": '''from pathlib import Path

UPLOADS = Path("uploads")

def read_upload(filename):
    return (UPLOADS / filename).read_text(encoding="utf-8")
''',
        "labels": [{"type": "PATH_TRAVERSAL", "lineStart": 6, "lineEnd": 6, "severity": "HIGH"}],
    },
    {
        "id": "path-traversal-negative",
        "source": '''from pathlib import Path

UPLOADS = Path("uploads").resolve()

def read_upload(filename):
    candidate = (UPLOADS / filename).resolve()
    if not candidate.is_relative_to(UPLOADS):
        raise ValueError("invalid upload path")
    return candidate.read_text(encoding="utf-8")
''',
        "labels": [],
    },
    {
        "id": "boundary-logic-positive",
        "source": '''def can_register(age):
    """People aged 18 or older are allowed to register."""
    return age > 18
''',
        "labels": [{"type": "BOUNDARY_LOGIC", "lineStart": 3, "lineEnd": 3, "severity": "MEDIUM"}],
    },
    {
        "id": "boundary-logic-negative",
        "source": '''def can_register(age):
    """People aged 18 or older are allowed to register."""
    return age >= 18
''',
        "labels": [],
    },
]
