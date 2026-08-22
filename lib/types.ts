export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type IssueStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "APPLIED" | "VERIFIED";

export interface Project { id: string; name: string; language: string; updatedAt: string; version: string; }
export interface Issue {
  id: string; filePath: string; lineStart: number; lineEnd: number; ruleCode: string;
  type: string; severity: Severity; description: string; confidence: number; status: IssueStatus;
  explanation: string; impact: string;
}
export interface FixProposal { issueId: string; originalCode: string; replacementCode: string; reason: string; }
export interface TestRun { id: string; version: string; status: "PASS" | "FAIL" | "RUNNING"; total: number; passed: number; failed: number; errors: number; duration: string; createdAt: string; }
