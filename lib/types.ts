export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type IssueStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "APPLIED" | "VERIFIED" | "FAILED";
export type Role = "developer" | "admin";

export interface User { id: string; email: string; fullName: string; role: Role; isActive: boolean; }
export interface LoginResponse { token: string; user: User; }
export interface Project { id: string; name: string; language: string; updatedAt: string; version: string; }
export interface SourceFile { id: string; path: string; sizeBytes: number; updatedAt: string; }
export interface FileContent { path: string; content: string; }
export interface Issue {
  id: string; filePath: string; lineStart: number; lineEnd: number; ruleCode: string;
  type: string; severity: Severity; description: string; confidence: number | null; status: IssueStatus;
  explanation: string; impact: string;
}
export interface FixProposal { issueId: string; originalCode: string; replacementCode: string; reason: string; patchText?: string; }
export interface TestRun { id: string; version: string; status: "PASS" | "FAIL" | "RUNNING"; total: number; passed: number; failed: number; errors: number; duration: string; createdAt: string; output?: string | null; }
export interface CodeVersion { id: string; version: string; sourcePath: string; createdAt: string; createdBy?: string | null; }
export interface TestCase { id: string; name: string; code: string; createdAt?: string; }
export interface Capabilities { aiConfigured: boolean; analysisModes: string[]; sandboxImage: string; }
export interface AdminUser extends User { createdAt: string; updatedAt: string; projectCount: number; issueCount: number; }
export interface AdminProject extends Project { ownerName: string; ownerId: string; issueCount: number; }
export interface Activity { id: string; action: string; actorName: string; projectName: string | null; createdAt: string; }
export interface AdminOverview {
  users: AdminUser[];
  projects: AdminProject[];
  activities: Activity[];
  metrics: {
    users: number; activeUsers: number; projects: number; issues: number; verifiedIssues: number;
    testRuns: number; precision: number | null; recall: number | null; fixSuccessRate: number | null;
  };
}
