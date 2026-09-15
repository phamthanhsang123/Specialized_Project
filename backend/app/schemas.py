from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


Severity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
IssueStatus = Literal["PENDING", "ACCEPTED", "REJECTED", "APPLIED", "VERIFIED", "FAILED"]
TestStatus = Literal["PASS", "FAIL", "RUNNING"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    language: str = "Python 3.12"


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ProjectOut(BaseModel):
    id: str
    name: str
    language: str
    updatedAt: str
    version: str
    lastScannedVersion: str | None = None
    sourceFileCount: int = 0
    issueCount: int = 0
    pendingIssueCount: int = 0
    latestTestStatus: TestStatus | None = None
    deletedAt: str | None = None


class FileOut(BaseModel):
    id: str
    path: str
    sizeBytes: int
    updatedAt: datetime

    model_config = ConfigDict(from_attributes=True)


class FileContentOut(BaseModel):
    path: str
    content: str


class IssueOut(BaseModel):
    id: str
    filePath: str
    lineStart: int
    lineEnd: int
    ruleCode: str
    type: str
    severity: Severity
    description: str
    confidence: float | None = None
    status: IssueStatus
    explanation: str
    impact: str


class FixProposalOut(BaseModel):
    issueId: str
    originalCode: str
    replacementCode: str
    reason: str
    patchText: str


class TestRunOut(BaseModel):
    id: str
    version: str
    status: TestStatus
    total: int
    passed: int
    failed: int
    errors: int
    duration: str
    createdAt: datetime
    output: str | None = None


class PreviewComparisonInput(BaseModel):
    runtime: Literal["python", "javascript", "typescript"] = "javascript"
    installCommand: str = Field(default="npm install", max_length=1000)
    startCommand: str = Field(min_length=1, max_length=1000)
    port: int = Field(default=3000, ge=1024, le=65535)


class PreviewTargetOut(BaseModel):
    label: Literal["before", "after"]
    version: str
    url: str


class PreviewComparisonOut(BaseModel):
    sessionId: str
    provider: str
    expiresAt: datetime
    before: PreviewTargetOut | None = None
    after: PreviewTargetOut


class VersionOut(BaseModel):
    id: str
    version: str
    sourcePath: str
    createdAt: datetime
    createdBy: str | None = None
    reason: str = "SOURCE_UPDATED"
    fileCount: int = 0
    changedFileCount: int = 0


class UploadOut(BaseModel):
    projectId: str
    files: list[FileOut]
    version: str


class ScanOut(BaseModel):
    projectId: str
    issues: list[IssueOut]


class MessageOut(BaseModel):
    message: str

