"""Trusted image wrapper: export the test report while container tmpfs still exists."""

import base64
from pathlib import Path
import subprocess
import sys


report = Path("/tmp/sentinel-report.xml")
result = subprocess.run([
    sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
    "--import-mode=importlib", f"--junitxml={report}", *sys.argv[1:],
])
if report.is_file() and report.stat().st_size <= 1_000_000:
    print("\n__SENTINEL_JUNIT_V1__=" + base64.b64encode(report.read_bytes()).decode("ascii"), flush=True)
else:
    print("\nKhông có báo cáo pytest hoặc báo cáo vượt quá 1 MB.", flush=True)
sys.exit(result.returncode)
