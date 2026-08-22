from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


Severity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
IssueStatus = Literal["PENDING", "ACCEPTED", "REJECTED", "APPLIED", "VERIFIED"]
TestStatus = Literal["PASS", "FAIL", "RUNNING"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    language: str = "Python 3.12"


class ProjectOut(BaseModel):
    id: str
    name: str
    language: str
    updatedAt: str
    version: str


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
    confidence: float
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


class VersionOut(BaseModel):
    id: str
    version: str
    sourcePath: str
    createdAt: datetime
    createdBy: str | None = None


class UploadOut(BaseModel):
    projectId: str
    files: list[FileOut]
    version: str


class ScanOut(BaseModel):
    projectId: str
    issues: list[IssueOut]


class MessageOut(BaseModel):
    message: str

