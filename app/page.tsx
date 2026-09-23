"use client";
import { t } from "../lib/i18n";
import { useTranslation } from "react-i18next";
import Swal from "sweetalert2";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, apiFetch, errorMessage, isAborted } from "../lib/api";
import { useSession } from "../lib/auth";
import type {
  Capabilities,
  CodeVersion,
  FileContent,
  FixProposal,
  Issue,
  IssueStatus,
  Project,
  PreviewComparison,
  PreviewRuntime,
  Severity,
  SourceFile,
  TestCase,
  TestRun,
  VersionDiff,
} from "../lib/types";
import {
  dateLabel,
  Empty,
  highlightPython,
  Icon,
  initials,
  SessionGate,
} from "./components/ui";
import { useMessage } from "./components/use-message";
import { useDialog } from "./components/use-dialog";
import TestExplanation from "./components/test-explanation";
import TestComparison from "./components/test-comparison";
import { useStepFocus } from "./components/use-step-focus";
import RecoveryBanner from "./components/recovery-banner";
const severityLabel: Record<Severity, string> = {
  CRITICAL: "Nghiêm trọng",
  HIGH: "Cao",
  MEDIUM: "Trung bình",
  LOW: "Thấp",
};
const statusLabel: Record<IssueStatus, string> = {
  PENDING: "Chờ duyệt",
  ACCEPTED: "Đã chấp nhận",
  REJECTED: "Đã từ chối",
  APPLIED: "Đã áp dụng",
  VERIFIED: "Đã xác minh",
  FAILED: "Xác minh thất bại",
};
const workflowSteps = [
  {
    id: "source",
    label: "Mã nguồn",
    icon: "code",
    description: "Tải và chuẩn bị file",
  },
  {
    id: "analysis",
    label: "Vấn đề & bản sửa",
    icon: "spark",
    description: "Phân tích và duyệt đề xuất",
  },
  {
    id: "testing",
    label: "Kiểm thử",
    icon: "flask",
    description: "Chạy test và xác minh",
  },
  {
    id: "versions",
    label: "Lịch sử",
    icon: "clock",
    description: "Phiên bản và khôi phục",
  },
];
const workflowStateLabel = {
  ready: "Sẵn sàng",
  locked: "Chưa sẵn sàng",
  processing: "Đang xử lý",
  complete: "Hoàn tất",
  failed: "Chưa đạt",
};
interface ProjectData {
  project: Project;
  files: SourceFile[];
  issues: Issue[];
  tests: TestRun[];
  versions: CodeVersion[];
  testCases: TestCase[];
}
interface UploadItem {
  file: File;
  path: string;
}
interface UploadSelection {
  mode: "files" | "folder";
  label: string;
  items: UploadItem[];
  ignoredCount: number;
  totalBytes: number;
}
const MAX_UPLOAD_FILES = 500;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_PREVIEW_LIMIT = 6;
const SOURCE_FILE_PATTERN =
  /\.(py|js|jsx|mjs|cjs|ts|tsx|json|html?|css|scss|sass|less|vue|svelte|toml|ya?ml)$/i;
const SOURCE_FILE_ACCEPT =
  ".zip,.py,.js,.jsx,.mjs,.cjs,.ts,.tsx,.json,.html,.htm,.css,.scss,.sass,.less,.vue,.svelte,.txt,.toml,.yaml,.yml";
const IGNORED_SOURCE_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);
const AI_SCAN_MINIMUM_MS = 3400;
const AI_SCAN_SUCCESS_MS = 450;
const AI_SCAN_MESSAGES = [
  "Đang đọc mã nguồn...",
  "Đang kiểm tra lỗi...",
  "Đang phân tích vấn đề...",
  "Đang chuẩn bị kết quả...",
];

function wait(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds),
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function sourceBadge(path: string) {
  const extension = path.split(".").pop()?.toLocaleLowerCase() ?? "";
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "JS";
  if (["ts", "tsx"].includes(extension)) return "TS";
  if (["html", "htm"].includes(extension)) return "HT";
  if (["css", "scss", "sass", "less"].includes(extension)) return "CS";
  if (extension === "json") return "{}";
  return extension === "py" ? "PY" : "TX";
}
function supportedSourceName(name: string) {
  return SOURCE_FILE_PATTERN.test(name) || /^requirements.*\.txt$/i.test(name);
}
function supportedFolderFile(file: File) {
  const path = (file.webkitRelativePath || file.name).replace(/\\/g, "/");
  const parts = path.split("/");
  return (
    supportedSourceName(file.name) &&
    !parts
      .slice(0, -1)
      .some((part) => IGNORED_SOURCE_DIRECTORIES.has(part.toLocaleLowerCase()))
  );
}
function PreviewFrame({
  title,
  target,
  emptyText,
}: {
  title: string;
  target: PreviewComparison["before"];
  emptyText?: string;
}) {
  return (
    <article className="preview-frame-card">
      <div className="preview-frame-head">
        <div>
          <b>{title}</b>
          {target && <small>{target.version}</small>}
        </div>
        {target && (
          <a href={target.url} target="_blank" rel="noreferrer">
            {t("Mở toàn màn hình")}
          </a>
        )}
      </div>
      {target ? (
        <iframe
          title={`${title} ${target.version}`}
          src={target.url}
          sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="preview-frame-empty">{emptyText}</div>
      )}
    </article>
  );
}
function versionReasonLabel(reason?: string) {
  if (reason?.startsWith("ROLLBACK:")) {
    return t("Khôi phục từ {{version}}", {
      version: reason.slice("ROLLBACK:".length),
    });
  }
  if (reason === "INITIAL") return t("Phiên bản ban đầu");
  if (reason === "FIX_APPLIED") return t("Áp dụng bản sửa đã duyệt");
  if (reason === "SOURCE_UPLOADED") return t("Tải mã nguồn mới");
  return t("Cập nhật mã nguồn");
}
export default function Home() {
  useTranslation();
  const { user, sessionError, logout, retrySession } = useSession("developer");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const currentProject = useRef("");
  const requestSerial = useRef(0);
  const projectController = useRef<AbortController | null>(null);
  const actionInProgress = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  const [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [recovery, setRecovery] = useMessage();
  const [data, setData] = useState<ProjectData | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useMessage();
  const [notice, setNotice] = useMessage();
  const [error, setError] = useState("");
  const [activeNav, setActiveNav] = useState("projects");
  const [processingStep, setProcessingStep] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [content, setContent] = useState<FileContent | null>(null);
  const [fileError, setFileError] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [proposalError, setProposalError] = useState("");
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalReload, setProposalReload] = useState(0);
  const [projectSearch, setProjectSearch] = useState("");
  const [reviewTab, setReviewTab] = useState<"explanation" | "diff" | "source">(
    "explanation",
  );
  const [aiScanPhase, setAiScanPhase] = useState<
    "idle" | "scanning" | "success"
  >("idle");
  const [aiScanMessageIndex, setAiScanMessageIndex] = useState(0);
  const [acceptFeedback, setAcceptFeedback] = useState<{
    issueId: string;
    phase: "loading" | "success";
  } | null>(null);
  const [reviewInProgress, setReviewInProgress] = useState(false);
  const [testSection, setTestSection] = useState<
    "results" | "cases" | "preview"
  >("results");
  const [filter, setFilter] = useState<Severity | "ALL">("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedProjects, setDeletedProjects] = useState<Project[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedError, setDeletedError] = useState("");
  const [showUpload, setShowUpload] = useState<UploadSelection | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<CodeVersion | null>(
    null,
  );
  const [versionDiff, setVersionDiff] = useState<VersionDiff | null>(null);
  const [versionDetailTarget, setVersionDetailTarget] =
    useState<CodeVersion | null>(null);
  const [versionDiffLoading, setVersionDiffLoading] = useState(false);
  const [versionDiffError, setVersionDiffError] = useState("");
  const [testName, setTestName] = useState("test_project.py");
  const [testCode, setTestCode] = useState("");
  const [testEditorId, setTestEditorId] = useState("");
  const [testBaseline, setTestBaseline] = useState({
    name: "test_project.py",
    code: "",
  });
  const [previewRuntime, setPreviewRuntime] =
    useState<PreviewRuntime>("javascript");
  const [previewInstallCommand, setPreviewInstallCommand] =
    useState("npm install");
  const [previewStartCommand, setPreviewStartCommand] = useState(
    "npm run dev -- --host 0.0.0.0",
  );
  const [previewPort, setPreviewPort] = useState(3000);
  const [previewComparison, setPreviewComparison] =
    useState<PreviewComparison | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const testDirty =
    testName !== testBaseline.name || testCode !== testBaseline.code;
  const dirtyRef = useRef(false);
  dirtyRef.current = testDirty;
  const confirmDiscard = useCallback(
    () =>
      !dirtyRef.current ||
      window.confirm(
        t("Nội dung test chưa được lưu. Bạn có chắc muốn bỏ các thay đổi?"),
      ),
    [],
  );
  useEffect(() => {
    if (!testDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [testDirty]);
  const viewport = useStepFocus(activeNav, projectId);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [analysisMode, setAnalysisMode] = useState<"static" | "ai">("static");
  const folderInputRef = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);
  const issues = data?.issues ?? [];
  const filteredIssues = useMemo(
    () => issues.filter((item) => filter === "ALL" || item.severity === filter),
    [issues, filter],
  );
  const selectedIssue =
    filteredIssues.find((item) => item.id === selectedIssueId) ??
    filteredIssues[0];
  const selectedIssueKey = selectedIssue?.id ?? "";
  const loadedProjectId = data?.project.id ?? "";
  const sourceVersion = data?.project.version ?? "";
  const isPythonProject =
    data?.project.language.toLocaleLowerCase().includes("python") ?? true;
  const selectedProposal =
    proposal?.issueId === selectedIssue?.id ? proposal : null;
  const counts = useMemo(
    () => ({
      total: issues.length,
      critical: issues.filter((item) => item.severity === "CRITICAL").length,
      high: issues.filter((item) => item.severity === "HIGH").length,
      medium: issues.filter((item) => item.severity === "MEDIUM").length,
      low: issues.filter((item) => item.severity === "LOW").length,
      pending: issues.filter((item) => item.status === "PENDING").length,
      accepted: issues.filter((item) => item.status === "ACCEPTED").length,
      resolved: issues.filter((item) =>
        ["APPLIED", "VERIFIED"].includes(item.status),
      ).length,
      verified: issues.filter((item) => item.status === "VERIFIED").length,
    }),
    [issues],
  );
  const currentVersionTest = data?.tests.find(
    (run) => run.version === data.project.version && run.status !== "RUNNING",
  );
  const sourceReady = Boolean(data?.files.length);
  const analysisReady = Boolean(
    sourceReady &&
    (data?.project.lastScannedVersion === data?.project.version ||
      data?.issues.some((issue) => issue.status === "APPLIED")),
  );
  function workflowState(id: string) {
    if (processingStep === id) return "processing";
    if (id === "source") return sourceReady ? "complete" : "ready";
    if (id === "analysis") {
      if (!sourceReady) return "locked";
      return analysisReady ? "complete" : "ready";
    }
    if (id === "testing") {
      if (!analysisReady) return "locked";
      if (currentVersionTest?.status === "FAIL") return "failed";
      return currentVersionTest?.status === "PASS" ? "complete" : "ready";
    }
    if (!data?.versions.length) return "locked";
    return currentVersionTest?.status === "PASS" ? "complete" : "ready";
  }
  const selectProject = useCallback(
    (id: string, approved = false) => {
      if (id && currentProject.current === id) {
        setActiveNav("source");
        return;
      }
      if (!approved && !confirmDiscard()) return;
      currentProject.current = id;
      projectController.current?.abort();
      requestSerial.current += 1;
      setProjectId(id);
      setActiveNav(id ? "source" : "projects");
      setData(null);
      setStale(false);
      setRecovery("");
      setSelectedFile("");
      setSelectedIssueId("");
      setContent(null);
      setProposal(null);
      setNotice("");
      setError("");
      setFilter("ALL");
      setReviewTab("explanation");
      setTestSection("results");
      setTestName("test_project.py");
      setTestCode("");
      setTestEditorId("");
      setTestBaseline({ name: "test_project.py", code: "" });
      setPreviewComparison(null);
      setPreviewError("");
      setShowUpload(null);
      setRollbackTarget(null);
      setVersionDiff(null);
      setVersionDetailTarget(null);
      setVersionDiffError("");
    },
    [confirmDiscard],
  );
  const loadProjects = useCallback(
    async (signal?: AbortSignal) => {
      setListLoading(true);
      try {
        const result = await apiFetch<Project[]>("/projects", {
          signal,
        });
        if (signal?.aborted) return false;
        setProjects(result);
        if (!result.some((item) => item.id === currentProject.current))
          selectProject("");
        if (!currentProject.current) {
          setStale(false);
          setRecovery("");
        }
        return true;
      } catch (failure) {
        if (!isAborted(failure)) setError(errorMessage(failure));
        return false;
      } finally {
        if (!signal?.aborted) setListLoading(false);
      }
    },
    [selectProject],
  );
  const refreshProject = useCallback(
    async (id: string, options: { silent?: boolean } = {}) => {
      if (currentProject.current !== id) return false;
      projectController.current?.abort();
      const controller = new AbortController();
      projectController.current = controller;
      const serial = ++requestSerial.current;
      const requestOptions = {
        signal: controller.signal,
      };
      const base = `/projects/${encodeURIComponent(id)}`;
      if (!options.silent) setLoading(true);
      try {
        const [project, files, newIssues, tests, versions, testCases] =
          await Promise.all([
            apiFetch<Project>(base, requestOptions),
            apiFetch<SourceFile[]>(`${base}/files`, requestOptions),
            apiFetch<Issue[]>(`${base}/issues`, requestOptions),
            apiFetch<TestRun[]>(`${base}/test-runs`, requestOptions),
            apiFetch<CodeVersion[]>(`${base}/versions`, requestOptions),
            apiFetch<TestCase[]>(`${base}/test-cases`, requestOptions),
          ]);
        if (
          currentProject.current !== id ||
          serial !== requestSerial.current ||
          controller.signal.aborted
        )
          return false;
        setData({
          project,
          files,
          issues: newIssues,
          tests,
          versions,
          testCases,
        });
        setProjects((current) =>
          current.map((item) => (item.id === id ? project : item)),
        );
        setSelectedFile((current) =>
          files.some((item) => item.path === current)
            ? current
            : (files[0]?.path ?? ""),
        );
        setSelectedIssueId((current) =>
          newIssues.some((item) => item.id === current)
            ? current
            : (newIssues[0]?.id ?? ""),
        );
        setStale(false);
        setRecovery("");
        setError("");
        return true;
      } catch (failure) {
        if (
          !isAborted(failure) &&
          currentProject.current === id &&
          serial === requestSerial.current
        ) {
          setStale(true);
          setError(
            t("Không tải được dữ liệu project: {{v0}}", {
              v0: errorMessage(failure),
            }),
          );
        }
        return false;
      } finally {
        if (
          !options.silent &&
          currentProject.current === id &&
          serial === requestSerial.current
        )
          setLoading(false);
      }
    },
    [],
  );
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void loadProjects(controller.signal);
    apiFetch<Capabilities>("/capabilities", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setCapabilities(result);
        }
      })
      .catch((failure: unknown) => {
        if (!isAborted(failure)) setCapabilityError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [user, loadProjects]);
  useEffect(() => {
    if (projectId && user) void refreshProject(projectId);
    return () => projectController.current?.abort();
  }, [projectId, user, refreshProject]);
  useEffect(() => {
    const language = data?.project.language.toLocaleLowerCase();
    if (!language) return;
    if (language.includes("typescript")) {
      selectPreviewRuntime("typescript");
      setTestSection("preview");
    } else if (language.includes("javascript")) {
      selectPreviewRuntime("javascript");
      setTestSection("preview");
    } else {
      selectPreviewRuntime("python");
    }
  }, [data?.project.id, data?.project.language]);
  useEffect(() => {
    if (aiScanPhase !== "scanning") return;
    setAiScanMessageIndex(0);
    const timer = window.setInterval(
      () =>
        setAiScanMessageIndex(
          (current) => (current + 1) % AI_SCAN_MESSAGES.length,
        ),
      800,
    );
    return () => window.clearInterval(timer);
  }, [aiScanPhase]);
  useEffect(() => {
    setContent(null);
    setFileError("");
    if (!selectedFile || loadedProjectId !== projectId) return;
    const controller = new AbortController();
    apiFetch<FileContent>(
      `/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(selectedFile)}`,
      {
        signal: controller.signal,
      },
    )
      .then((result) => {
        if (!controller.signal.aborted && currentProject.current === projectId)
          setContent(result);
      })
      .catch((failure: unknown) => {
        if (!isAborted(failure) && currentProject.current === projectId)
          setFileError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [selectedFile, projectId, loadedProjectId, sourceVersion]);
  useEffect(() => {
    setProposal(null);
    setProposalError("");
    setProposalLoading(false);
    if (!selectedIssueKey) return;
    const controller = new AbortController();
    setProposalLoading(true);
    apiFetch<{
      issue: Issue;
      proposal: FixProposal | null;
    }>(`/issues/${encodeURIComponent(selectedIssueKey)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted && currentProject.current === projectId)
          setProposal(result.proposal);
      })
      .catch((failure: unknown) => {
        if (!isAborted(failure) && currentProject.current === projectId)
          setProposalError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted && currentProject.current === projectId)
          setProposalLoading(false);
      });
    return () => controller.abort();
  }, [selectedIssueKey, projectId, proposalReload]);
  async function performAction<Result>(
    label: string,
    action: (id: string, signal: AbortSignal) => Promise<Result>,
    success: string,
    step = "",
    options: {
      refresh?: boolean;
      showNotice?: boolean;
      globalBusy?: boolean;
      onSuccess?: (result: Result) => void;
    } = {},
  ) {
    const id = currentProject.current;
    if (!id || actionInProgress.current || stale || uncertain) return false;
    const controller = new AbortController();
    actionController.current = controller;
    actionInProgress.current = true;
    if (options.globalBusy !== false) setBusy(label);
    setError("");
    setNotice("");
    setRecovery("");
    setProcessingStep(step);
    try {
      const result = await action(id, controller.signal);
      if (currentProject.current === id) {
        if (options.refresh === false) {
          options.onSuccess?.(result);
          if (options.showNotice !== false) setNotice(success);
        } else {
          const fresh = await refreshProject(id, { silent: true });
          if (fresh && options.showNotice !== false) setNotice(success);
          else if (!fresh)
            setRecovery(
              "Thao tác đã được lưu, nhưng chưa tải được dữ liệu mới. Hãy tải lại dữ liệu; không gửi lại thao tác.",
            );
        }
      }
      return true;
    } catch (failure) {
      if (currentProject.current === id) {
        setError(isAborted(failure) ? "" : errorMessage(failure));
        if (
          isAborted(failure) ||
          (failure instanceof ApiError && failure.uncertain)
        ) {
          setStale(true);
          setUncertain(true);
          setRecovery(
            "Chưa xác định kết quả thao tác. Dừng chờ không hủy xử lý trên máy chủ. Hãy kiểm tra dữ liệu và tránh gửi lặp.",
          );
        }
      }
      return false;
    } finally {
      actionInProgress.current = false;
      if (options.globalBusy !== false) setBusy("");
      setProcessingStep("");
      if (actionController.current === controller)
        actionController.current = null;
    }
  }
  function navigate(id: string) {
    setActiveNav(id);
    setNotice("");
  }
  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionInProgress.current) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;
    if (uncertain || !confirmDiscard()) return;
    actionInProgress.current = true;
    setBusy("Đang tạo project…");
    setError("");
    try {
      const created = await apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          language: "Python 3.12",
        }),
      });
      setProjects((current) => [created, ...current]);
      selectProject(created.id, true);
      setShowCreate(false);
      setNotice("Đã tạo {{v0}}. Tải source để bắt đầu.", { v0: created.name });
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiError && failure.uncertain) {
        setUncertain(true);
        setStale(true);
        setShowCreate(false);
        setRecovery(
          "Chưa xác định kết quả thao tác. Dừng chờ không hủy xử lý trên máy chủ. Hãy kiểm tra dữ liệu và tránh gửi lặp.",
        );
      }
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  async function deleteProject(project: Project) {
    if (actionInProgress.current || uncertain) return;
    const confirmation = await Swal.fire({
      title: t("Xóa dự án?"),
      text: t(
        'Bạn có chắc chắn muốn xóa dự án "{{name}}"? Dự án sẽ được chuyển vào thùng rác và có thể khôi phục trước khi xóa vĩnh viễn.',
        { name: project.name },
      ),
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: t("Xóa dự án"),
      cancelButtonText: t("Hủy"),
      reverseButtons: true,
      focusCancel: true,
      buttonsStyling: false,
      customClass: {
        popup: "sentinel-alert",
        actions: "sentinel-alert-actions",
        confirmButton: "sentinel-alert-delete",
        cancelButton: "sentinel-alert-cancel",
      },
    });
    if (!confirmation.isConfirmed) return;
    actionInProgress.current = true;
    setBusy("Đang xóa dự án…");
    setError("");
    try {
      await apiFetch(`/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });
      setProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );
      setDeletedProjects((current) => [
        { ...project, deletedAt: new Date().toISOString() },
        ...current.filter((item) => item.id !== project.id),
      ]);
      if (currentProject.current === project.id) selectProject("", true);
      setNotice("Đã xóa dự án {{v0}}.", { v0: project.name });
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiError && failure.uncertain) {
        setUncertain(true);
        setStale(true);
        setRecovery(
          "Chưa xác định dự án đã được xóa hay chưa. Hãy đồng bộ lại danh sách trước khi thử lại.",
        );
      }
      setBusy("");
      await Swal.fire({
        title: t("Không thể xóa dự án"),
        text: t("Vui lòng thử lại sau khi kiểm tra kết nối với máy chủ."),
        icon: "error",
        confirmButtonText: t("Đóng"),
        buttonsStyling: false,
        customClass: {
          popup: "sentinel-alert",
          confirmButton: "sentinel-alert-primary",
        },
      });
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  async function renameProject(project: Project) {
    if (actionInProgress.current || uncertain) return;
    const result = await Swal.fire<string>({
      title: t("Đổi tên dự án"),
      text: t("Nhập tên mới để dễ nhận biết dự án của bạn."),
      input: "text",
      inputValue: project.name,
      inputAttributes: {
        maxlength: "255",
        autocapitalize: "off",
        "aria-label": t("Tên dự án mới"),
      },
      showCancelButton: true,
      confirmButtonText: t("Lưu tên mới"),
      cancelButtonText: t("Hủy"),
      reverseButtons: true,
      focusCancel: false,
      buttonsStyling: false,
      customClass: {
        popup: "sentinel-alert sentinel-rename-alert",
        input: "sentinel-alert-input",
        actions: "sentinel-alert-actions",
        confirmButton: "sentinel-alert-primary",
        cancelButton: "sentinel-alert-cancel",
      },
      inputValidator: (value) => {
        const name = value.trim();
        if (!name) return t("Tên dự án không được để trống.");
        if (name === project.name) return t("Tên mới phải khác tên hiện tại.");
        return undefined;
      },
    });
    if (!result.isConfirmed || !result.value) return;
    const name = result.value.trim();
    actionInProgress.current = true;
    setBusy("Đang đổi tên dự án…");
    setError("");
    try {
      const updated = await apiFetch<Project>(
        `/projects/${encodeURIComponent(project.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name }),
        },
      );
      setProjects((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setData((current) =>
        current?.project.id === updated.id
          ? { ...current, project: updated }
          : current,
      );
      setNotice("Đã đổi tên dự án thành {{v0}}.", { v0: updated.name });
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiError && failure.uncertain) {
        setUncertain(true);
        setStale(true);
        setRecovery(
          "Chưa xác định tên dự án đã được cập nhật hay chưa. Hãy đồng bộ lại danh sách trước khi thử lại.",
        );
      }
      await Swal.fire({
        title: t("Không thể đổi tên dự án"),
        text: t("Vui lòng thử lại sau khi kiểm tra kết nối với máy chủ."),
        icon: "error",
        confirmButtonText: t("Đóng"),
        buttonsStyling: false,
        customClass: {
          popup: "sentinel-alert",
          confirmButton: "sentinel-alert-primary",
        },
      });
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  async function openDeletedProjects() {
    setShowDeleted(true);
    setDeletedLoading(true);
    setDeletedError("");
    try {
      setDeletedProjects(await apiFetch<Project[]>("/projects/deleted"));
    } catch (failure) {
      if (!isAborted(failure)) setDeletedError(errorMessage(failure));
    } finally {
      setDeletedLoading(false);
    }
  }
  async function restoreDeletedProject(project: Project) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy("Đang khôi phục dự án…");
    setDeletedError("");
    try {
      const restored = await apiFetch<Project>(
        `/projects/${encodeURIComponent(project.id)}/restore`,
        { method: "POST" },
      );
      setDeletedProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );
      setProjects((current) => [
        restored,
        ...current.filter((item) => item.id !== restored.id),
      ]);
      setShowDeleted(false);
      setNotice("Đã khôi phục dự án {{v0}}.", { v0: restored.name });
    } catch (failure) {
      setDeletedError(errorMessage(failure));
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  async function permanentlyDeleteProject(project: Project) {
    if (actionInProgress.current) return;
    const confirmation = await Swal.fire({
      title: t("Xóa vĩnh viễn dự án?"),
      text: t(
        'Dự án "{{name}}" cùng toàn bộ dữ liệu sẽ bị xóa vĩnh viễn và không thể khôi phục.',
        { name: project.name },
      ),
      icon: "error",
      showCancelButton: true,
      confirmButtonText: t("Xóa vĩnh viễn"),
      cancelButtonText: t("Hủy"),
      reverseButtons: true,
      focusCancel: true,
      buttonsStyling: false,
      customClass: {
        popup: "sentinel-alert",
        actions: "sentinel-alert-actions",
        confirmButton: "sentinel-alert-delete",
        cancelButton: "sentinel-alert-cancel",
      },
    });
    if (!confirmation.isConfirmed) return;
    actionInProgress.current = true;
    setBusy("Đang xóa vĩnh viễn…");
    setDeletedError("");
    try {
      await apiFetch(`/projects/${encodeURIComponent(project.id)}/permanent`, {
        method: "DELETE",
      });
      setDeletedProjects((current) =>
        current.filter((item) => item.id !== project.id),
      );
      setShowDeleted(false);
      setNotice("Đã xóa vĩnh viễn dự án {{v0}}.", { v0: project.name });
    } catch (failure) {
      setDeletedError(errorMessage(failure));
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  function rejectUpload(message: string) {
    setShowUpload(null);
    setNotice("");
    setError(message);
  }
  function validateUpload(selection: UploadSelection) {
    if (selection.items.length > MAX_UPLOAD_FILES) {
      rejectUpload(
        t("Chỉ được chọn tối đa {{v0}} tệp mỗi lần.", { v0: MAX_UPLOAD_FILES }),
      );
      return false;
    }
    if (selection.totalBytes > MAX_UPLOAD_BYTES) {
      rejectUpload(
        t("Tổng dung lượng tệp đã chọn vượt quá giới hạn sơ bộ 10 MB."),
      );
      return false;
    }
    const normalizedPaths = selection.items.map((item) =>
      item.path.toLocaleLowerCase(),
    );
    if (new Set(normalizedPaths).size !== normalizedPaths.length) {
      rejectUpload(
        t("Có tệp trùng đường dẫn trong lựa chọn. Hãy đổi tên hoặc chọn lại."),
      );
      return false;
    }
    setError("");
    setNotice("");
    setShowUpload(selection);
    return true;
  }
  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (
      files.some(
        (file) => !supportedSourceName(file.name) && !/\.zip$/i.test(file.name),
      )
    ) {
      rejectUpload(
        t("Chỉ hỗ trợ mã nguồn Python, JavaScript, TypeScript hoặc ZIP."),
      );
      return;
    }
    const zipCount = files.filter((file) => /\.zip$/i.test(file.name)).length;
    if (zipCount && files.length > 1) {
      rejectUpload(
        t(
          "Không thể tải ZIP cùng các tệp khác. Hãy chọn một ZIP hoặc nhiều tệp mã nguồn.",
        ),
      );
      return;
    }
    const items = files.map((file) => ({
      file,
      path: file.name,
    }));
    validateUpload({
      mode: "files",
      label:
        files.length === 1
          ? files[0].name
          : t("{{v0}} tệp mã nguồn", { v0: files.length }),
      items,
      ignoredCount: 0,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
    });
  }
  function chooseFolder(event: ChangeEvent<HTMLInputElement>) {
    const chosenFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!chosenFiles.length) {
      rejectUpload(t("Thư mục này không có mã nguồn được hỗ trợ để tải lên."));
      return;
    }
    const sourceFiles = chosenFiles.filter(supportedFolderFile);
    if (!sourceFiles.length) {
      rejectUpload(t("Thư mục này không có mã nguồn được hỗ trợ để tải lên."));
      return;
    }
    const rawPaths = sourceFiles.map((file) =>
      (file.webkitRelativePath || file.name)
        .replace(/\\/g, "/")
        .split("/")
        .filter((part) => part && part !== "." && part !== "..")
        .join("/"),
    );
    const root = rawPaths[0]?.split("/")[0] ?? "";
    const commonRoot = Boolean(
      root && rawPaths.every((path) => path.startsWith(`${root}/`)),
    );
    const items = sourceFiles.map((file, index) => ({
      file,
      path: commonRoot
        ? rawPaths[index].slice(root.length + 1) || file.name
        : rawPaths[index] || file.name,
    }));
    validateUpload({
      mode: "folder",
      label: commonRoot ? root : t("Thư mục đã chọn"),
      items,
      ignoredCount: chosenFiles.length - sourceFiles.length,
      totalBytes: sourceFiles.reduce((total, file) => total + file.size, 0),
    });
  }
  function closeUpload() {
    if (busy) return;
    setShowUpload(null);
    setError("");
  }
  async function upload() {
    if (!showUpload) return;
    const form = new FormData();
    showUpload.items.forEach((item) =>
      form.append("file", item.file, item.path),
    );
    const success = await performAction(
      "Đang tải source…",
      (id, signal) =>
        apiFetch(`/projects/${id}/upload`, {
          signal,
          method: "POST",
          body: form,
        }),
      "Đã lưu source. Hãy quét để phân tích phiên bản mới.",
      "source",
    );
    if (success) {
      setShowUpload(null);
      setPreviewComparison(null);
      setActiveNav("source");
    }
  }
  async function reviewIssue(action: "accept" | "reject") {
    if (!selectedIssue) return;
    const issueId = selectedIssue.id;
    setReviewInProgress(true);
    if (action === "accept") {
      setAcceptFeedback({ issueId, phase: "loading" });
    }
    const succeeded = await performAction(
      "Đang lưu quyết định…",
      (id, signal) =>
        apiFetch<{ issue: Issue }>(
          `/issues/${encodeURIComponent(selectedIssue.id)}/${action}`,
          {
            signal,
            method: "POST",
          },
        ),
      action === "accept"
        ? "Đã chấp nhận đề xuất. Nhấn Áp dụng để thay đổi source."
        : "Đã từ chối đề xuất.",
      "",
      {
        refresh: false,
        showNotice: false,
        globalBusy: false,
        onSuccess: ({ issue }) => {
          setData((current) => {
            if (!current) return current;
            const nextIssues = current.issues.map((item) =>
              item.id === issue.id ? issue : item,
            );
            return {
              ...current,
              project: {
                ...current.project,
                pendingIssueCount: nextIssues.filter(
                  (item) => item.status === "PENDING",
                ).length,
              },
              issues: nextIssues,
            };
          });
        },
      },
    );
    setReviewInProgress(false);
    if (action !== "accept") return;
    if (!succeeded) {
      setAcceptFeedback(null);
      return;
    }
    setAcceptFeedback({ issueId, phase: "success" });
    await wait(550);
    setAcceptFeedback(null);
  }

  async function runAnalysis() {
    const useAI = analysisMode === "ai";
    if (useAI) {
      viewport.current?.scrollTo({ top: 0 });
      setAiScanPhase("scanning");
    }
    const succeeded = await performAction(
      "Đang quét…",
      async (id, signal) => {
        const request = apiFetch(
          `/projects/${id}/${useAI ? "ai-scan" : "scan"}`,
          { signal, method: "POST" },
        );
        if (useAI) await Promise.all([request, wait(AI_SCAN_MINIMUM_MS)]);
        else await request;
      },
      "Quét hoàn tất. Kết quả được lấy từ source đang lưu.",
      "analysis",
    );
    if (!succeeded) {
      setAiScanPhase("idle");
      return;
    }
    if (useAI) {
      setAiScanPhase("success");
      await wait(AI_SCAN_SUCCESS_MS);
      setNotice("");
      setActiveNav("analysis");
      setAiScanPhase("idle");
      return;
    }
    setNotice("");
    setActiveNav("analysis");
  }
  async function saveTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = { name: testName.trim(), code: testCode };
    const success = await performAction(
      "Đang lưu test…",
      (id, signal) =>
        apiFetch(`/projects/${id}/test-cases`, {
          signal,
          method: "POST",
          body: JSON.stringify({
            name: testName.trim(),
            code: testCode,
          }),
        }),
      "Đã lưu test case vào project.",
    );
    if (success) {
      setTestEditorId(saved.name);
      setTestName(saved.name);
      setTestBaseline(saved);
    }
  }
  function selectPreviewRuntime(runtime: PreviewRuntime) {
    setPreviewRuntime(runtime);
    if (runtime === "python") {
      setPreviewInstallCommand("pip install -r requirements.txt");
      setPreviewStartCommand("uvicorn app.main:app --host 0.0.0.0 --port 8000");
      setPreviewPort(8000);
      return;
    }
    setPreviewInstallCommand("npm install");
    setPreviewStartCommand("npm run dev -- --host 0.0.0.0");
    setPreviewPort(3000);
  }
  async function createPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || previewBusy) return;
    const requestedProject = projectId;
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const result = await apiFetch<PreviewComparison>(
        `/projects/${encodeURIComponent(requestedProject)}/preview-comparisons`,
        {
          method: "POST",
          timeoutMs: 600000,
          body: JSON.stringify({
            runtime: previewRuntime,
            installCommand: previewInstallCommand,
            startCommand: previewStartCommand,
            port: previewPort,
          }),
        },
      );
      if (currentProject.current === requestedProject)
        setPreviewComparison(result);
    } catch (failure) {
      if (!isAborted(failure)) setPreviewError(errorMessage(failure));
    } finally {
      if (currentProject.current === requestedProject) setPreviewBusy(false);
    }
  }
  async function stopPreview() {
    if (!projectId || !previewComparison || previewBusy) return;
    const requestedProject = projectId;
    const sessionId = previewComparison.sessionId;
    setPreviewBusy(true);
    setPreviewError("");
    try {
      await apiFetch(
        `/projects/${encodeURIComponent(requestedProject)}/preview-comparisons/${encodeURIComponent(sessionId)}`,
        { method: "DELETE", timeoutMs: 90000 },
      );
      if (currentProject.current === requestedProject)
        setPreviewComparison(null);
    } catch (failure) {
      if (!isAborted(failure)) setPreviewError(errorMessage(failure));
    } finally {
      if (currentProject.current === requestedProject) setPreviewBusy(false);
    }
  }
  async function viewVersion(version: CodeVersion) {
    if (!projectId || versionDiffLoading) return;
    setVersionDetailTarget(version);
    setVersionDiff(null);
    setVersionDiffError("");
    setVersionDiffLoading(true);
    try {
      const result = await apiFetch<VersionDiff>(
        `/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(version.version)}/diff`,
      );
      if (currentProject.current === projectId) setVersionDiff(result);
    } catch (failure) {
      if (!isAborted(failure)) setVersionDiffError(errorMessage(failure));
    } finally {
      setVersionDiffLoading(false);
    }
  }
  useDialog(
    showCreate ||
      showDeleted ||
      Boolean(showUpload) ||
      Boolean(rollbackTarget) ||
      Boolean(versionDetailTarget),
    Boolean(busy),
    () => {
      setShowCreate(false);
      setShowDeleted(false);
      setShowUpload(null);
      setRollbackTarget(null);
      setVersionDetailTarget(null);
      setVersionDiff(null);
      setVersionDiffError("");
      setError("");
    },
  );
  if (!user)
    return (
      <SessionGate error={sessionError} retry={retrySession} logout={logout} />
    );
  const disabled = Boolean(busy || loading || !data || stale || uncertain);
  const activeWorkflowIndex = workflowSteps.findIndex(
    (item) => item.id === activeNav,
  );
  return (
    <main className="shell connected-shell workspace-v2">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="spark" />
          </span>
          <span>sentinel</span>
        </div>
        <p className="sidebar-caption">{t("KHÔNG GIAN DEVELOPER")}</p>
        <nav aria-label={t("Điều hướng Developer")}>
          <button
            className={`nav-item${activeNav === "projects" ? " active" : ""}`}
            disabled={Boolean(busy)}
            aria-current={activeNav === "projects" ? "page" : undefined}
            onClick={() => navigate("projects")}
          >
            <Icon name="folder" />
            <span>{t("Dự án của tôi")}</span>
          </button>
          <button
            className={`nav-item${activeNav !== "projects" ? " active" : ""}`}
            disabled={Boolean(busy) || !projectId}
            title={
              !projectId ? t("Chọn một dự án để bắt đầu") : data?.project.name
            }
            aria-current={activeNav !== "projects" ? "page" : undefined}
            onClick={() => navigate("source")}
          >
            <Icon name="code" />
            <span>{t("Không gian dự án")}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <span className="avatar">{initials(user.fullName)}</span>
            <div>
              <b>{user.fullName}</b>
              <small>Lập trình viên</small>
            </div>
          </div>
          <button
            className="logout-button"
            onClick={() => {
              if (confirmDiscard()) void logout();
            }}
          >
            {t("Đăng xuất")}
          </button>
        </div>
      </aside>
      <section
        className={`content${activeNav === "source" ? " source-content" : ""}${aiScanPhase !== "idle" ? " ai-scan-active" : ""}`}
        ref={viewport}
      >
        <header
          className={`workspace-header${activeNav !== "projects" ? " project-header" : ""}`}
        >
          <div className="breadcrumbs">
            <button
              className="text-link"
              disabled={Boolean(busy)}
              onClick={() => navigate("projects")}
            >
              {t("Dự án của tôi")}
            </button>
            {activeNav !== "projects" && (
              <>
                <span>/</span>
                <b>{data?.project.name}</b>
                <span className="version">{data?.project.version}</span>
              </>
            )}
          </div>
          {activeNav !== "projects" && (
            <nav
              className="workflow-tabs workflow-rail"
              aria-label={t("Các bước trong dự án")}
            >
              {workflowSteps.map((item, index) => {
                const state = workflowState(item.id);
                const nextState = workflowSteps[index + 1]
                  ? workflowState(workflowSteps[index + 1].id)
                  : "locked";
                const suggestedNext =
                  index === activeWorkflowIndex + 1 && state !== "locked";
                return (
                  <div className="workflow-stage" key={item.id}>
                    <button
                      className={`workflow-step ${state}${suggestedNext ? " next-ready" : ""}`}
                      disabled={Boolean(busy) || state === "locked"}
                      aria-current={activeNav === item.id ? "step" : undefined}
                      aria-label={`${index + 1}. ${t(item.label)} — ${t(workflowStateLabel[state])}. ${t(item.description)}`}
                      onClick={() => navigate(item.id)}
                    >
                      <span className="workflow-step-number">
                        {state === "complete"
                          ? "✓"
                          : state === "failed"
                            ? "!"
                            : index + 1}
                      </span>
                      <span className="workflow-step-copy">
                        <strong>{t(item.label)}</strong>
                        <small>{t(workflowStateLabel[state])}</small>
                      </span>
                    </button>
                    {index < workflowSteps.length - 1 && (
                      <span
                        className={`workflow-connector ${nextState === "complete" ? "complete" : ""}${nextState === "processing" ? " processing" : ""}`}
                        aria-hidden="true"
                      >
                        <i />
                        <b>›</b>
                      </span>
                    )}
                  </div>
                );
              })}
            </nav>
          )}
          {activeNav !== "projects" && processingStep && (
            <p className="sr-only" role="status">
              {t("Đang xử lý bước {{step}}.", {
                step: t(
                  workflowSteps.find((item) => item.id === processingStep)
                    ?.label ?? "",
                ),
              })}
            </p>
          )}
        </header>
        {aiScanPhase !== "idle" && (
          <div
            className={`ai-scan-stage ${aiScanPhase}`}
            role="status"
            aria-live="polite"
          >
            <div className="ai-scan-indicator" aria-hidden="true">
              <span className="ai-scan-ring" />
              <span className="ai-scan-core">
                <Icon
                  name={aiScanPhase === "success" ? "check" : "spark"}
                  size={34}
                />
              </span>
            </div>
            <strong>
              {aiScanPhase === "success"
                ? t("Phân tích hoàn tất")
                : t("AI đang phân tích mã nguồn")}
            </strong>
            <small key={aiScanMessageIndex}>
              {aiScanPhase === "success"
                ? t("Đang mở kết quả...")
                : t(AI_SCAN_MESSAGES[aiScanMessageIndex])}
            </small>
          </div>
        )}
        {busy && aiScanPhase === "idle" && !reviewInProgress && (
          <div className="toast" role="status">
            {busy}
            {actionController.current && (
              <button
                className="text-link"
                title={t("Dừng chờ không hủy xử lý trên máy chủ.")}
                onClick={() => actionController.current?.abort()}
              >
                {t("Dừng chờ")}
              </button>
            )}
          </div>
        )}
        <RecoveryBanner
          message={recovery}
          stale={stale}
          uncertain={uncertain}
          loading={loading || Boolean(busy) || listLoading}
          refresh={() => {
            void (projectId ? refreshProject(projectId) : loadProjects()).then(
              (fresh) => {
                if (fresh && !uncertain) setRecovery("");
              },
            );
          }}
          acknowledge={() => {
            setUncertain(false);
            setRecovery("");
            setError("");
          }}
        />
        {error && (
          <div className="toast toast-error" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                if (projectId) void refreshProject(projectId);
                else void loadProjects();
              }}
            >
              {t("Thử lại")}
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            {notice}
            <button
              className="text-link"
              aria-label={t("Đóng")}
              onClick={() => setNotice("")}
            >
              {t("×")}
            </button>
          </div>
        )}
        {activeNav === "projects" ? (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">{t("BẮT ĐẦU TỪ DỰ ÁN")}</p>
                <h1>{t("Dự án của tôi")}</h1>
                <p>
                  {t(
                    "Chọn dự án để tiếp tục, hoặc tạo dự án mới để phân tích mã nguồn.",
                  )}
                </p>
              </div>
              <div className="project-heading-actions">
                <button
                  className="deleted-projects-button"
                  disabled={Boolean(busy) || uncertain}
                  onClick={() => void openDeletedProjects()}
                >
                  <span aria-hidden="true">↺</span>
                  {t("Đã xóa gần đây")}
                </button>
                <button
                  className="primary-button"
                  disabled={Boolean(busy) || uncertain}
                  onClick={() => setShowCreate(true)}
                >
                  {t("＋ Tạo dự án")}
                </button>
              </div>
            </div>
            <label className="search-field">
              <Icon name="folder" />
              <input
                aria-label={t("Tìm dự án")}
                placeholder={t("Tìm dự án…")}
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
              />
            </label>
            {listLoading ? (
              <div
                className="project-cards project-skeleton-grid"
                role="status"
                aria-label={t("Đang tải dự án…")}
              >
                {[0, 1, 2].map((item) => (
                  <div className="project-card-skeleton" key={item}>
                    <i className="skeleton-square" />
                    <i className="skeleton-line skeleton-title" />
                    <i className="skeleton-line" />
                    <span>
                      <i className="skeleton-pill" />
                      <i className="skeleton-pill" />
                    </span>
                    <i className="skeleton-line skeleton-short" />
                  </div>
                ))}
              </div>
            ) : !projects.length ? (
              <div className="panel welcome-card">
                <Icon name="folder" size={40} />
                <h2>{t("Tạo dự án đầu tiên")}</h2>
                <p>
                  {t(
                    "Tải mã nguồn, phân tích vấn đề và duyệt bản sửa trong một quy trình rõ ràng.",
                  )}
                </p>
                <button
                  className="primary-button"
                  disabled={Boolean(busy) || uncertain}
                  onClick={() => setShowCreate(true)}
                >
                  {t("＋ Tạo dự án")}
                </button>
              </div>
            ) : (
              <div className="project-cards">
                {projects
                  .filter((p) =>
                    p.name
                      .toLocaleLowerCase()
                      .includes(projectSearch.toLocaleLowerCase()),
                  )
                  .map((p) => (
                    <article className="project-card" key={p.id}>
                      <button
                        className="project-rename"
                        type="button"
                        aria-label={t("Đổi tên dự án {{name}}", {
                          name: p.name,
                        })}
                        title={t("Đổi tên dự án")}
                        disabled={Boolean(busy) || uncertain}
                        onClick={() => void renameProject(p)}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                      <button
                        className="project-delete"
                        type="button"
                        aria-label={t("Xóa dự án {{name}}", { name: p.name })}
                        title={t("Xóa dự án")}
                        disabled={Boolean(busy) || uncertain}
                        onClick={() => void deleteProject(p)}
                      >
                        ×
                      </button>
                      <button
                        className="project-card-main"
                        type="button"
                        disabled={Boolean(busy) || uncertain}
                        onClick={() => selectProject(p.id)}
                      >
                        <span className="project-card-icon">
                          <Icon name="folder" size={24} />
                        </span>
                        <span className="project-card-title">{p.name}</span>
                        <span className="project-meta">
                          {p.language} · {p.version} ·{" "}
                          {t("{{count}} tệp", {
                            count: p.sourceFileCount ?? 0,
                          })}
                        </span>
                        <span className="project-health">
                          <span>
                            {t("{{count}} vấn đề", {
                              count: p.issueCount ?? 0,
                            })}
                          </span>
                          <span>
                            {p.latestTestStatus
                              ? `${t("Test gần nhất")}: ${t(p.latestTestStatus)}`
                              : t("Chưa kiểm thử")}
                          </span>
                        </span>
                        <span className="project-meta">
                          {t("Cập nhật")} {dateLabel(p.updatedAt)}
                        </span>
                        <span className="project-open">{t("Mở dự án →")}</span>
                      </button>
                    </article>
                  ))}
              </div>
            )}
            {!listLoading &&
              projects.length > 0 &&
              !projects.some((p) =>
                p.name
                  .toLocaleLowerCase()
                  .includes(projectSearch.toLocaleLowerCase()),
              ) && <Empty>{t("Không tìm thấy dự án phù hợp.")}</Empty>}
          </>
        ) : (
          <>
            {loading && <Empty>{t("Đang tải dữ liệu dự án…")}</Empty>}
            {data && (
              <>
                {activeNav === "source" && (
                  <section className="source-page">
                    <div className="source-toolbar">
                      <div className="inline-actions">
                        {" "}
                        <label
                          className={`outline-button upload-label${disabled ? " is-disabled" : ""}`}
                          aria-disabled={disabled}
                        >
                          <Icon name="upload" size={16} />
                          {t("Tải tệp")}
                          <input
                            type="file"
                            accept={SOURCE_FILE_ACCEPT}
                            multiple
                            onChange={chooseFiles}
                            disabled={disabled}
                            aria-label={t(
                              "Tải một hoặc nhiều tệp mã nguồn, hoặc một tệp ZIP",
                            )}
                          />
                        </label>
                        <label
                          className={`outline-button upload-label${disabled ? " is-disabled" : ""}`}
                          aria-disabled={disabled}
                        >
                          <Icon name="folder" size={16} />
                          {t("Tải thư mục")}
                          <input
                            ref={folderInputRef}
                            type="file"
                            accept={SOURCE_FILE_ACCEPT.replace(".zip,", "")}
                            multiple
                            onChange={chooseFolder}
                            disabled={disabled}
                            aria-label={t(
                              "Tải toàn bộ thư mục mã nguồn được hỗ trợ",
                            )}
                          />
                        </label>
                      </div>
                    </div>{" "}
                    <div className="analysis-controls">
                      <label>
                        {t("Chế độ phân tích")}
                        <select
                          value={analysisMode}
                          disabled={disabled}
                          onChange={(event) =>
                            setAnalysisMode(
                              event.target.value as "static" | "ai",
                            )
                          }
                        >
                          <option value="static">{t("Quy tắc tĩnh")}</option>
                          <option
                            value="ai"
                            disabled={!capabilities?.aiConfigured}
                          >
                            {capabilities?.aiConfigured
                              ? "AI"
                              : t("AI — chưa cấu hình")}
                          </option>
                        </select>
                      </label>
                      <p className="engine-note">
                        {capabilities?.aiConfigured
                          ? t(
                              "AI chỉ nhận source từ project khi bạn bấm thao tác AI. Nội dung được gửi tới dịch vụ AI đã cấu hình; cần review đề xuất trước khi áp dụng.",
                            )
                          : capabilities
                            ? t(
                                "AI chưa được cấu hình. Bạn vẫn có thể dùng bộ phân tích quy tắc tĩnh; các chỉ số AI chưa có dữ liệu đo.",
                              )
                            : t(
                                "Đang kiểm tra cấu hình AI. Bộ phân tích quy tắc tĩnh vẫn khả dụng.",
                              )}
                      </p>
                      {capabilityError && (
                        <p className="error-text">
                          {t("Không đọc được cấu hình AI:")} {capabilityError}
                        </p>
                      )}
                    </div>
                    <div className="scan-action">
                      {" "}
                      <button
                        className="primary-button"
                        disabled={disabled || !data?.files.length}
                        onClick={() => void runAnalysis()}
                      >
                        <Icon name="spark" size={16} />
                        {analysisMode === "ai"
                          ? t("Quét bằng AI")
                          : t("Quét source")}
                      </button>
                      <p>
                        {!data.files.length
                          ? t("Tải mã nguồn để bật chức năng phân tích.")
                          : t(
                              "Kết quả phân tích sẽ xuất hiện trong Vấn đề & bản sửa.",
                            )}
                      </p>
                    </div>
                    <section className="source-workspace">
                      {" "}
                      <article className="panel file-panel">
                        <div className="panel-title">
                          <div>
                            <b>{t("Mã nguồn")}</b>
                            <small>
                              {t("{{count}} tệp", { count: data.files.length })}
                            </small>
                          </div>
                        </div>
                        <div className="file-list">
                          {data.files.map((file) => (
                            <button
                              className={`file-row${selectedFile === file.path ? " selected" : ""}`}
                              key={file.id}
                              title={file.path}
                              onClick={() => setSelectedFile(file.path)}
                            >
                              <span className="py-icon">
                                {sourceBadge(file.path)}
                              </span>
                              <span>{file.path}</span>
                            </button>
                          ))}
                          {!data.files.length && (
                            <Empty>
                              {t(
                                "Tải mã nguồn Python, JavaScript, TypeScript, ZIP hoặc cả thư mục để bắt đầu.",
                              )}
                            </Empty>
                          )}
                        </div>
                      </article>
                      <article className="panel code-panel">
                        <div className="panel-title">
                          <div className="file-title">
                            <span className="py-icon">
                              {sourceBadge(selectedFile)}
                            </span>
                            <b>{selectedFile || t("Chưa chọn tệp")}</b>
                          </div>
                          <small>UTF-8</small>
                        </div>
                        {fileError ? (
                          <Empty>{fileError}</Empty>
                        ) : content && content.path === selectedFile ? (
                          <pre className="code-view">
                            {content.content.split("\n").map((line, index) => (
                              <div
                                className={`code-line${selectedFile === selectedIssue?.filePath && index + 1 >= selectedIssue.lineStart && index + 1 <= selectedIssue.lineEnd ? " flagged" : ""}`}
                                key={index}
                              >
                                <span>{index + 1}</span>
                                <code>{highlightPython(line || " ")}</code>
                              </div>
                            ))}
                          </pre>
                        ) : (
                          <Empty>
                            {selectedFile
                              ? t("Đang tải mã nguồn…")
                              : t("Chưa có mã nguồn.")}
                          </Empty>
                        )}
                        <div className="code-footer">
                          <span>Python</span>
                          <span>
                            {content
                              ? t("{{v0}} dòng", {
                                  v0: content.content.split("\n").length,
                                })
                              : "—"}
                          </span>
                        </div>
                      </article>
                    </section>
                  </section>
                )}
                {activeNav === "analysis" && (
                  <>
                    <section className="review-workspace">
                      {" "}
                      <article className="panel issue-panel" id="analysis">
                        <div className="panel-title">
                          <div>
                            <b>{t("Kết quả phân tích")}</b>
                            <small>
                              {t("{{count}} vấn đề", {
                                count: filteredIssues.length,
                              })}
                            </small>
                          </div>
                          <select
                            className="filter-button"
                            value={filter}
                            aria-label={t("Lọc mức độ lỗi")}
                            onChange={(event) =>
                              setFilter(event.target.value as Severity | "ALL")
                            }
                          >
                            <option value="ALL">{t("Tất cả")}</option>
                            {Object.entries(severityLabel).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {t(label)}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                        <div className="issue-list">
                          {filteredIssues.map((issue, index) => (
                            <button
                              className={`issue-card${selectedIssue?.id === issue.id ? " selected" : ""}`}
                              key={issue.id}
                              style={{
                                animationDelay: `${Math.min(index, 8) * 45}ms`,
                              }}
                              onClick={() => {
                                setSelectedIssueId(issue.id);
                                setSelectedFile(issue.filePath);
                                setActiveNav("analysis");
                              }}
                            >
                              <div className="issue-top">
                                <span
                                  className={`severity ${issue.severity.toLowerCase()}`}
                                >
                                  {t(severityLabel[issue.severity])}
                                </span>
                                <span>{issue.ruleCode}</span>
                              </div>
                              <b>{t(issue.type)}</b>
                              <small className="issue-card-meta">
                                <span title={issue.filePath}>
                                  {issue.filePath}
                                </span>
                                <span>
                                  {t("Dòng")} {issue.lineStart}
                                </span>
                                <span
                                  className={`status ${issue.status.toLowerCase()}`}
                                >
                                  {t(statusLabel[issue.status])}
                                </span>
                              </small>
                            </button>
                          ))}
                          {!filteredIssues.length && (
                            <Empty>
                              {issues.length
                                ? t("Không có vấn đề ở mức đã chọn.")
                                : t(
                                    "Danh sách hiện tại chưa có vấn đề. Nhấn Quét source để cập nhật phân tích.",
                                  )}
                            </Empty>
                          )}
                        </div>
                      </article>
                      <article
                        className="panel proposal-panel"
                        key={selectedIssue?.id ?? "empty"}
                      >
                        <div className="panel-title proposal-heading">
                          {selectedIssue ? (
                            <div className="proposal-heading-main">
                              <div className="proposal-title-line">
                                <h2>{t(selectedIssue.type)}</h2>
                                <span
                                  className={`severity ${selectedIssue.severity.toLowerCase()}`}
                                >
                                  {t(severityLabel[selectedIssue.severity])}
                                </span>
                                <span
                                  className={`status ${selectedIssue.status.toLowerCase()}`}
                                >
                                  {t(statusLabel[selectedIssue.status])}
                                </span>
                              </div>
                              <p className="proposal-location">
                                <span>{selectedIssue.ruleCode}</span>
                                <b>{selectedIssue.filePath}</b>
                                <span>
                                  {t("Dòng")} {selectedIssue.lineStart}
                                </span>
                              </p>
                            </div>
                          ) : (
                            <b>{t("Chi tiết vấn đề")}</b>
                          )}
                        </div>
                        {selectedIssue ? (
                          <>
                            <div
                              className="review-tabs"
                              role="tablist"
                              aria-label={t("Chi tiết vấn đề")}
                            >
                              <button
                                role="tab"
                                aria-selected={reviewTab === "explanation"}
                                onClick={() => setReviewTab("explanation")}
                              >
                                {t("Tổng quan")}
                              </button>
                              <button
                                role="tab"
                                aria-selected={reviewTab === "diff"}
                                onClick={() => setReviewTab("diff")}
                              >
                                {t("Bản sửa")}
                              </button>
                              <button
                                className="text-link"
                                onClick={() => {
                                  setSelectedFile(selectedIssue.filePath);
                                  setReviewTab("source");
                                }}
                                role="tab"
                                aria-selected={reviewTab === "source"}
                              >
                                {t("Mã nguồn")}
                              </button>
                            </div>
                            <div
                              className="review-tab-panel"
                              hidden={reviewTab !== "explanation"}
                            >
                              <div className="issue-overview-blocks">
                                <section>
                                  <b>{t("Mô tả")}</b>
                                  <p>{t(selectedIssue.description)}</p>
                                  <p>{t(selectedIssue.explanation)}</p>
                                </section>
                                <section className="impact-block">
                                  <b>{t("Ảnh hưởng")}</b>
                                  <p>{t(selectedIssue.impact)}</p>
                                </section>
                              </div>
                              <details className="technical-details">
                                <summary>{t("Chi tiết kỹ thuật")}</summary>
                                <p>
                                  {selectedIssue.confidence == null
                                    ? t("Độ tin cậy: chưa đo")
                                    : `${Math.round(selectedIssue.confidence * 100)}%`}
                                </p>
                              </details>
                            </div>
                            <div
                              className="review-tab-panel"
                              hidden={reviewTab !== "diff"}
                            >
                              {proposalLoading ? (
                                <Empty>{t("Đang tải đề xuất…")}</Empty>
                              ) : proposalError ? (
                                <Empty>{proposalError}</Empty>
                              ) : selectedProposal ? (
                                <>
                                  <div className="diff-head">
                                    <b>{t("So sánh trước / sau")}</b>
                                    <span>
                                      {t("Đề xuất cần được review và kiểm thử")}
                                    </span>
                                  </div>
                                  <div className="diff">
                                    <div>
                                      <label>{t("− TRƯỚC")}</label>
                                      <pre>{selectedProposal.originalCode}</pre>
                                    </div>
                                    <div>
                                      <label>{t("+ SAU")}</label>
                                      <pre>
                                        {selectedProposal.replacementCode}
                                      </pre>
                                    </div>
                                  </div>
                                  <p className="reason">
                                    <b>{t("Lý do:")}</b>{" "}
                                    {t(selectedProposal.reason)}
                                  </p>
                                </>
                              ) : (
                                <div className="empty-proposal">
                                  {t(
                                    "Chưa có đề xuất sửa tự động an toàn cho vấn đề này. Cần review và sửa thủ công.",
                                  )}
                                  {capabilities?.aiConfigured &&
                                    selectedIssue.status === "PENDING" && (
                                      <button
                                        className="run-button ai-proposal-button"
                                        disabled={disabled}
                                        onClick={() =>
                                          void performAction(
                                            "Đang tạo đề xuất bằng AI…",
                                            (id, signal) =>
                                              apiFetch(
                                                `/issues/${encodeURIComponent(selectedIssue.id)}/ai-proposal`,
                                                { signal, method: "POST" },
                                              ),
                                            "Đã nhận đề xuất AI. Review diff và chạy test sau khi áp dụng.",
                                            "analysis",
                                          ).then((succeeded) => {
                                            if (succeeded)
                                              setProposalReload(
                                                (current) => current + 1,
                                              );
                                          })
                                        }
                                      >
                                        {t("Lấy đề xuất AI cho vấn đề này")}
                                      </button>
                                    )}
                                </div>
                              )}
                            </div>
                            <div
                              className="review-tab-panel"
                              hidden={reviewTab !== "source"}
                            >
                              {fileError ? (
                                <Empty>{fileError}</Empty>
                              ) : content &&
                                content.path === selectedIssue.filePath ? (
                                <pre className="code-view issue-source-view">
                                  {content.content
                                    .split("\n")
                                    .map((line, index) => (
                                      <div
                                        className={`code-line${index + 1 >= selectedIssue.lineStart && index + 1 <= selectedIssue.lineEnd ? " flagged" : ""}`}
                                        key={index}
                                      >
                                        <span>{index + 1}</span>
                                        <code>
                                          {highlightPython(line || " ")}
                                        </code>
                                      </div>
                                    ))}
                                </pre>
                              ) : (
                                <Empty>{t("Đang tải mã nguồn…")}</Empty>
                              )}
                            </div>
                            {["PENDING", "ACCEPTED", "REJECTED"].includes(
                              selectedIssue.status,
                            ) && (
                              <div className="review-actions">
                                <button
                                  type="button"
                                  className="reject-button"
                                  disabled={
                                    reviewInProgress ||
                                    disabled ||
                                    selectedIssue.status === "REJECTED"
                                  }
                                  onClick={() => void reviewIssue("reject")}
                                >
                                  <Icon name="x" size={16} />
                                  {selectedIssue.status === "ACCEPTED"
                                    ? t("Bỏ duyệt")
                                    : selectedIssue.status === "REJECTED"
                                      ? t("Đã từ chối")
                                      : t("Từ chối")}
                                </button>
                                <button
                                  type="button"
                                  className={`accept-button${selectedIssue.status === "ACCEPTED" || (acceptFeedback?.issueId === selectedIssue.id && acceptFeedback.phase === "success") ? " accept-success" : ""}`}
                                  title={
                                    !selectedProposal
                                      ? t(
                                          "Cần có đề xuất sửa trước khi chấp nhận.",
                                        )
                                      : t("Chấp nhận chưa thay đổi mã nguồn.")
                                  }
                                  disabled={
                                    reviewInProgress ||
                                    disabled ||
                                    selectedIssue.status === "ACCEPTED" ||
                                    !selectedProposal ||
                                    proposalLoading
                                  }
                                  onClick={() => void reviewIssue("accept")}
                                >
                                  {acceptFeedback?.issueId ===
                                    selectedIssue.id &&
                                  acceptFeedback.phase === "loading" ? (
                                    <>
                                      <span
                                        className="button-spinner"
                                        aria-hidden="true"
                                      />
                                      {t("Đang chấp nhận...")}
                                    </>
                                  ) : selectedIssue.status === "ACCEPTED" ||
                                    (acceptFeedback?.issueId ===
                                      selectedIssue.id &&
                                      acceptFeedback.phase === "success") ? (
                                    <>
                                      <Icon name="check" size={16} />
                                      {t("Đã chấp nhận")}
                                    </>
                                  ) : (
                                    <>
                                      <Icon name="check" size={16} />
                                      {selectedIssue.status === "REJECTED"
                                        ? t("Duyệt lại bản sửa")
                                        : t("Chấp nhận bản sửa")}
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <Empty>
                            {t("Chọn một vấn đề sau khi quét để xem đề xuất.")}
                          </Empty>
                        )}
                        <div
                          className={`apply-section${counts.accepted === 0 ? " apply-section-reserved" : ""}`}
                          aria-hidden={counts.accepted === 0}
                        >
                          <div>
                            <b>
                              {t("{{count}} đề xuất đang chờ áp dụng", {
                                count: counts.accepted,
                              })}
                            </b>
                            <small>
                              {t(
                                "Lưu phiên bản trước khi thay đổi source. Sau đó cần chạy test để xác minh.",
                              )}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={disabled || counts.accepted === 0}
                            onClick={() =>
                              void performAction(
                                "Đang áp dụng patch…",
                                (id, signal) =>
                                  apiFetch(`/projects/${id}/apply`, {
                                    signal,
                                    method: "POST",
                                  }),
                                "Đã tạo phiên bản mới. Chạy kiểm thử để kiểm tra thay đổi.",
                                "analysis",
                              ).then((ok) => {
                                if (ok) {
                                  setPreviewComparison(null);
                                  setTestSection(
                                    isPythonProject ? "results" : "preview",
                                  );
                                  setActiveNav("testing");
                                }
                              })
                            }
                          >
                            {t("Áp dụng {{count}} bản sửa đã duyệt", {
                              count: counts.accepted,
                            })}
                          </button>
                        </div>
                      </article>
                    </section>
                  </>
                )}
                {activeNav === "testing" && (
                  <section className="testing-workspace">
                    <article className="panel test-panel" id="testing">
                      <div className="panel-title">
                        <div>
                          <b>{t("Kiểm thử & xác minh")}</b>
                          <small>{t("Kết quả thực thi từ backend")}</small>
                        </div>
                        {isPythonProject ? (
                          <button
                            className="run-button"
                            disabled={disabled || !data.files.length}
                            onClick={() =>
                              void performAction(
                                "Đang chạy test trong sandbox…",
                                (id, signal) =>
                                  apiFetch(`/projects/${id}/test`, {
                                    signal,
                                    method: "POST",
                                  }),
                                "Đã nhận kết quả kiểm thử. Xem trạng thái và log bên dưới.",
                                "testing",
                              ).then((ok) => {
                                if (ok) setTestSection("results");
                              })
                            }
                          >
                            <Icon name="play" size={14} />
                            {t("Chạy test")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="run-button"
                            onClick={() => {
                              setError("");
                              setTestSection("preview");
                            }}
                          >
                            <Icon name="play" size={14} />
                            {t("Mở xem trước giao diện")}
                          </button>
                        )}
                      </div>
                      <div
                        className="test-subtabs"
                        role="tablist"
                        aria-label={t("Nội dung kiểm thử")}
                      >
                        {isPythonProject && (
                          <>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={testSection === "results"}
                              onClick={() => setTestSection("results")}
                            >
                              {t("Kết quả kiểm thử")}
                              <b>{data.tests.length}</b>
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={testSection === "cases"}
                              onClick={() => setTestSection("cases")}
                            >
                              {t("Quản lý test case")}
                              <b>{data.testCases.length}</b>
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          role="tab"
                          aria-selected={testSection === "preview"}
                          onClick={() => {
                            setError("");
                            setTestSection("preview");
                          }}
                        >
                          {t("Xem trước giao diện")}
                          <b>{previewComparison ? 1 : 0}</b>
                        </button>
                      </div>
                      {isPythonProject && testSection === "results" && (
                        <div className="test-results-section">
                          <TestComparison runs={data.tests} />
                          {data.tests.map((run) => (
                            <div className="test-result" key={run.id}>
                              <div className="test-run">
                                <span
                                  className={`run-icon ${run.status === "PASS" ? "pass-icon" : "fail-icon"}`}
                                >
                                  {run.status === "PASS" ? "✓" : "!"}
                                </span>
                                <div>
                                  <b>
                                    {run.version} · {t(run.status)}
                                  </b>
                                  <small>
                                    {run.passed}/{run.total} {t("đạt ·")}{" "}
                                    {run.failed} {t("lỗi ·")} {run.errors}{" "}
                                    {t("lỗi thực thi ·")} {run.duration}
                                  </small>
                                </div>
                                <span>{dateLabel(run.createdAt)}</span>
                              </div>
                              {run.output && (
                                <details className="test-output">
                                  <summary>{t("Xem log kiểm thử")}</summary>
                                  <pre>{run.output}</pre>
                                  {capabilities?.aiConfigured && (
                                    <TestExplanation
                                      projectId={projectId}
                                      runId={run.id}
                                    />
                                  )}
                                </details>
                              )}
                            </div>
                          ))}
                          {!data.tests.length && (
                            <Empty>
                              {t(
                                "Chưa có lượt kiểm thử. Chạy test trước khi Apply để ghi nhận baseline và chạy lại sau khi sửa.",
                              )}
                            </Empty>
                          )}
                          <p className="form-help panel-help">
                            {t(
                              "Nếu sandbox chưa sẵn sàng, hệ thống sẽ báo lỗi và không tạo kết quả giả.",
                            )}
                          </p>
                        </div>
                      )}
                      {isPythonProject && testSection === "cases" && (
                        <form className="test-case-form" onSubmit={saveTest}>
                          <h3>
                            {t("Bộ test pytest")}
                            {testDirty && (
                              <span className="draft-badge">
                                {t("Chưa lưu")}
                              </span>
                            )}
                          </h3>
                          {capabilities?.aiConfigured && (
                            <>
                              <button
                                type="button"
                                className="run-button"
                                disabled={disabled || !data.files.length}
                                onClick={() =>
                                  void performAction(
                                    "Đang sinh test bằng AI…",
                                    (id, signal) =>
                                      apiFetch(
                                        `/projects/${id}/test-cases/generate`,
                                        { signal, method: "POST" },
                                      ),
                                    "Đã lưu các test do AI tạo. Kiểm tra nội dung trước khi chạy.",
                                  )
                                }
                              >
                                {t("Sinh test bằng AI từ source")}
                              </button>
                              <small className="form-help">
                                {t(
                                  "Bấm để gửi source tới dịch vụ AI đã cấu hình.",
                                )}
                              </small>
                            </>
                          )}
                          <label>
                            {t("Test đã lưu")}
                            <select
                              value={testEditorId}
                              disabled={Boolean(busy)}
                              onChange={(event) => {
                                if (!confirmDiscard()) return;
                                const chosen = data.testCases.find(
                                  (item) => item.name === event.target.value,
                                );
                                setTestEditorId(event.target.value);
                                setTestName(chosen?.name ?? "test_project.py");
                                setTestCode(chosen?.code ?? "");
                                setTestBaseline({
                                  name: chosen?.name ?? "test_project.py",
                                  code: chosen?.code ?? "",
                                });
                              }}
                            >
                              <option value="">{t("＋ Test mới")}</option>
                              {data.testCases.map((item) => (
                                <option key={item.id} value={item.name}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            {t("Tên tệp test")}
                            <input
                              required
                              value={testName}
                              onChange={(event) =>
                                setTestName(event.target.value)
                              }
                              placeholder="test_project.py"
                              pattern="test_[A-Za-z0-9_]+\.py"
                              title={t("Tên dạng test_ten.py")}
                              disabled={Boolean(busy)}
                            />
                          </label>
                          <label>
                            {t("Nội dung pytest")}
                            <textarea
                              required
                              value={testCode}
                              onChange={(event) =>
                                setTestCode(event.target.value)
                              }
                              rows={8}
                              spellCheck={false}
                              placeholder={
                                "from calculator import divide\n\ndef test_divide():\n    assert divide(6, 2) == 3"
                              }
                              disabled={Boolean(busy)}
                            />
                          </label>
                          <button
                            className="outline-button"
                            disabled={disabled || !testCode.trim()}
                            type="submit"
                          >
                            {t("Lưu test case")}
                          </button>
                        </form>
                      )}
                      {testSection === "preview" && (
                        <div className="preview-section">
                          <div className="preview-intro">
                            <div>
                              <h3>{t("So sánh giao diện trước và sau")}</h3>
                              <p>
                                {t(
                                  "Chạy hai phiên bản trong sandbox riêng để kiểm tra trực tiếp bản sửa trên trình duyệt.",
                                )}
                              </p>
                            </div>
                            {previewComparison && (
                              <button
                                type="button"
                                className="outline-button danger-outline"
                                disabled={previewBusy}
                                onClick={() => void stopPreview()}
                              >
                                {t("Dừng bản xem trước")}
                              </button>
                            )}
                          </div>
                          {!capabilities?.previewConfigured && (
                            <div className="preview-config-note" role="status">
                              <Icon name="info" size={18} />
                              <div>
                                <b>{t("Chưa kết nối Daytona")}</b>
                                <p>
                                  {t(
                                    "Thêm DAYTONA_API_KEY vào backend/.env và khởi động lại backend. Khóa chỉ nằm ở máy chủ.",
                                  )}
                                </p>
                              </div>
                            </div>
                          )}
                          {!isPythonProject && (
                            <div className="preview-config-note" role="status">
                              <Icon name="info" size={18} />
                              <div>
                                <b>{t("Kiểm tra dự án web")}</b>
                                <p>
                                  {t(
                                    "Pytest chỉ dùng cho dự án Python. Với JavaScript hoặc TypeScript, hãy chạy giao diện để kiểm tra trực tiếp trước và sau khi sửa.",
                                  )}
                                </p>
                              </div>
                            </div>
                          )}
                          <form
                            className="preview-settings"
                            onSubmit={createPreview}
                          >
                            <label>
                              {t("Môi trường chạy")}
                              <select
                                value={previewRuntime}
                                disabled={previewBusy}
                                onChange={(event) =>
                                  selectPreviewRuntime(
                                    event.target.value as PreviewRuntime,
                                  )
                                }
                              >
                                <option value="javascript">
                                  JavaScript · Node.js
                                </option>
                                <option value="typescript">
                                  TypeScript · Node.js
                                </option>
                                <option value="python">Python</option>
                              </select>
                            </label>
                            <label>
                              {t("Cổng giao diện")}
                              <input
                                type="number"
                                min={1024}
                                max={65535}
                                required
                                value={previewPort}
                                disabled={previewBusy}
                                onChange={(event) =>
                                  setPreviewPort(Number(event.target.value))
                                }
                              />
                            </label>
                            <label className="preview-command-field">
                              {t("Lệnh cài đặt")}
                              <input
                                value={previewInstallCommand}
                                disabled={previewBusy}
                                onChange={(event) =>
                                  setPreviewInstallCommand(event.target.value)
                                }
                                placeholder="npm install"
                              />
                            </label>
                            <label className="preview-command-field">
                              {t("Lệnh chạy giao diện")}
                              <input
                                required
                                value={previewStartCommand}
                                disabled={previewBusy}
                                onChange={(event) =>
                                  setPreviewStartCommand(event.target.value)
                                }
                                placeholder="npm run dev -- --host 0.0.0.0"
                              />
                            </label>
                            <button
                              type="submit"
                              className="run-button preview-run-button"
                              disabled={
                                previewBusy ||
                                !capabilities?.previewConfigured ||
                                !previewStartCommand.trim()
                              }
                            >
                              {previewBusy ? (
                                <span className="button-spinner" />
                              ) : (
                                <Icon name="play" size={14} />
                              )}
                              {previewBusy
                                ? t("Đang khởi tạo sandbox…")
                                : t("Chạy xem trước/sau")}
                            </button>
                          </form>
                          <p className="form-help preview-help">
                            {t(
                              "Chỉ khi bấm chạy, mã nguồn hai phiên bản mới được gửi tới Daytona. Mỗi bản xem trước tự hết hạn sau {{count}} phút.",
                              { count: capabilities?.previewTtlMinutes ?? 30 },
                            )}
                          </p>
                          {previewError && (
                            <div className="preview-error" role="alert">
                              {previewError}
                            </div>
                          )}
                          {previewComparison && (
                            <>
                              <div
                                className="preview-config-note"
                                role="status"
                              >
                                <Icon name="info" size={18} />
                                <div>
                                  <b>{t("Nếu Daytona hiện cảnh báo")}</b>
                                  <p>
                                    {t(
                                      "Bấm Mở toàn màn hình, sau đó chọn Continue to Preview. Daytona sẽ ghi nhớ xác nhận trong một khoảng thời gian.",
                                    )}
                                  </p>
                                </div>
                              </div>
                              <div className="preview-comparison">
                                <PreviewFrame
                                  title={t("Trước khi sửa")}
                                  target={previewComparison.before}
                                  emptyText={t(
                                    "Chưa có phiên bản cũ để so sánh. Hãy áp dụng ít nhất một bản sửa.",
                                  )}
                                />
                                <PreviewFrame
                                  title={t("Sau khi sửa")}
                                  target={previewComparison.after}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  </section>
                )}
                {activeNav === "versions" && (
                  <section className="history-workspace">
                    {" "}
                    <article className="panel version-panel" id="versions">
                      <div className="panel-title">
                        <div>
                          <b>{t("Lịch sử phiên bản")}</b>
                          <small>
                            {t("Hiện tại:")} {data.project.version}
                          </small>
                        </div>
                      </div>
                      <div className="timeline">
                        {data.versions.map((version) => {
                          const versionTest = data.tests.find(
                            (run) => run.version === version.version,
                          );
                          return (
                            <div className="version-entry" key={version.id}>
                              <span
                                className={`timeline-node${version.version === data.project.version ? " current" : ""}`}
                              />
                              <div className="version-entry-head">
                                <b>
                                  {version.version}
                                  {version.version === data.project.version && (
                                    <small>{t("Hiện tại")}</small>
                                  )}
                                </b>
                                {versionTest && (
                                  <span
                                    className={`version-test ${versionTest.status.toLowerCase()}`}
                                  >
                                    {t(versionTest.status)}
                                  </span>
                                )}
                              </div>
                              <strong className="version-reason">
                                {versionReasonLabel(version.reason)}
                              </strong>
                              <div className="version-meta">
                                <span>
                                  {t("{{count}} tệp", {
                                    count:
                                      version.fileCount ?? data.files.length,
                                  })}
                                </span>
                                <span>
                                  {t("{{count}} tệp thay đổi", {
                                    count: version.changedFileCount ?? 0,
                                  })}
                                </span>
                                <span>
                                  {version.createdBy === user.id
                                    ? t("Bạn thực hiện")
                                    : t("Hệ thống thực hiện")}
                                </span>
                                <span>{dateLabel(version.createdAt)}</span>
                              </div>
                              <div className="version-actions">
                                <button
                                  className="admin-outline version-detail"
                                  disabled={disabled}
                                  onClick={() => void viewVersion(version)}
                                >
                                  {t("Xem thay đổi")}
                                </button>
                                {version.version !== data.project.version && (
                                  <button
                                    className="version-restore"
                                    disabled={disabled}
                                    onClick={() => setRollbackTarget(version)}
                                  >
                                    {t("Khôi phục nội dung")} {version.version}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {!data.versions.length && (
                        <Empty>
                          {t("Phiên bản đầu tiên sẽ được tạo khi tải source.")}
                        </Empty>
                      )}
                      <p className="form-help panel-help">
                        {t(
                          "Khôi phục tạo một phiên bản mới từ nội dung đã chọn và giữ lịch sử cũ.",
                        )}
                      </p>
                    </article>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </section>
      {showDeleted && (
        <div className="admin-modal-backdrop">
          <section
            className="admin-modal deleted-projects-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deleted-projects-title"
          >
            <button
              type="button"
              className="modal-close"
              aria-label={t("Đóng")}
              disabled={Boolean(busy)}
              onClick={() => setShowDeleted(false)}
            >
              {t("×")}
            </button>
            <p className="modal-eyebrow">{t("THÙNG RÁC DỰ ÁN")}</p>
            <h2 id="deleted-projects-title">{t("Dự án đã xóa gần đây")}</h2>
            <p className="deleted-projects-help">
              {t(
                "Bạn có thể khôi phục dự án hoặc xóa vĩnh viễn toàn bộ dữ liệu.",
              )}
            </p>
            {deletedError && (
              <p className="error-text" role="alert">
                {deletedError}
              </p>
            )}
            {deletedLoading ? (
              <div
                className="deleted-project-list"
                role="status"
                aria-label={t("Đang tải dự án đã xóa…")}
              >
                {[0, 1, 2].map((item) => (
                  <div
                    className="deleted-project-row deleted-row-skeleton"
                    key={item}
                  >
                    <i className="skeleton-square small" />
                    <span>
                      <i className="skeleton-line skeleton-title" />
                      <i className="skeleton-line skeleton-short" />
                    </span>
                    <i className="skeleton-button" />
                  </div>
                ))}
              </div>
            ) : deletedProjects.length ? (
              <div className="deleted-project-list">
                {deletedProjects.map((project) => (
                  <article key={project.id} className="deleted-project-row">
                    <span className="deleted-project-icon">
                      <Icon name="folder" size={19} />
                    </span>
                    <span>
                      <b>{project.name}</b>
                      <small>
                        {t("Đã xóa")}{" "}
                        {dateLabel(project.deletedAt ?? project.updatedAt)}
                      </small>
                    </span>
                    <span className="deleted-project-actions">
                      <button
                        className="restore-project-button"
                        disabled={Boolean(busy)}
                        onClick={() => void restoreDeletedProject(project)}
                      >
                        {t("Khôi phục")}
                      </button>
                      <button
                        className="permanent-delete-button"
                        disabled={Boolean(busy)}
                        onClick={() => void permanentlyDeleteProject(project)}
                      >
                        {t("Xóa vĩnh viễn")}
                      </button>
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="deleted-projects-empty">
                <Icon name="folder" size={30} />
                <b>{t("Chưa có dự án nào bị xóa")}</b>
                <span>{t("Các dự án đã xóa sẽ xuất hiện tại đây.")}</span>
              </div>
            )}
          </section>
        </div>
      )}
      {showCreate && (
        <div className="admin-modal-backdrop">
          <form
            className="admin-modal"
            onSubmit={createProject}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
          >
            <button
              type="button"
              className="modal-close"
              aria-label={t("Đóng")}
              disabled={Boolean(busy)}
              onClick={() => setShowCreate(false)}
            >
              {t("×")}
            </button>
            <h2 id="create-project-title">{t("Tạo dự án mới")}</h2>
            <label>
              {t("Tên project")}
              <input
                name="name"
                required
                maxLength={255}
                autoFocus
                placeholder={t("Ví dụ: Payment API")}
                disabled={Boolean(busy)}
              />
            </label>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <button
              className="admin-primary"
              disabled={Boolean(busy)}
              type="submit"
            >
              {busy || t("Tạo project")}
            </button>
          </form>
        </div>
      )}
      {showUpload && (
        <div className="admin-modal-backdrop">
          <div
            className="admin-modal upload-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
            aria-describedby="upload-description"
          >
            <button
              type="button"
              className="modal-close"
              aria-label={t("Đóng cửa sổ tải source")}
              disabled={Boolean(busy)}
              onClick={closeUpload}
            >
              {t("×")}
            </button>
            <h2 id="upload-title">
              {t("Tải")}{" "}
              {showUpload.mode === "folder"
                ? t("thư mục {{v0}}", { v0: showUpload.label })
                : showUpload.label}
            </h2>
            <p>
              {t("Đã chọn")} {showUpload.items.length} {t("tệp (")}
              {formatBytes(showUpload.totalBytes)}).{" "}
              {showUpload.ignoredCount > 0
                ? t("Đã bỏ qua {{v0}} tệp không được hỗ trợ.", {
                    v0: showUpload.ignoredCount,
                  })
                : ""}
            </p>
            <ul
              className="upload-preview"
              aria-label={t("Các tệp sẽ được tải lên")}
            >
              {showUpload.items.slice(0, UPLOAD_PREVIEW_LIMIT).map((item) => (
                <li key={item.path}>{item.path}</li>
              ))}
            </ul>
            {showUpload.items.length > UPLOAD_PREVIEW_LIMIT && (
              <p className="upload-more">
                {t("Và")} {showUpload.items.length - UPLOAD_PREVIEW_LIMIT}{" "}
                {t("tệp khác…")}
              </p>
            )}
            <p id="upload-description">
              {t("Thao tác này sẽ thay toàn bộ source đang lưu của project")}{" "}
              {data?.project.name}
              {t(". Những phiên bản cũ vẫn được giữ để khôi phục.")}
            </p>
            <p>
              {t(
                "Các kết quả quét và quyết định review hiện tại sẽ được làm mới theo source mới.",
              )}
            </p>
            <p className="upload-limit">
              {t(
                "Giới hạn kiểm tra sơ bộ: 500 tệp, tổng 10 MB. Máy chủ sẽ kiểm tra lại trước khi lưu.",
              )}
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="inline-actions">
              <button
                className="outline-button"
                disabled={Boolean(busy)}
                onClick={closeUpload}
              >
                {t("Hủy")}
              </button>
              <button
                className="primary-button"
                disabled={Boolean(busy)}
                onClick={() => void upload()}
              >
                {busy || t("Tải và thay source")}
              </button>
            </div>
          </div>
        </div>
      )}
      {versionDetailTarget && (
        <div className="admin-modal-backdrop">
          <div
            className="admin-modal version-diff-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-diff-title"
          >
            <button
              type="button"
              className="modal-close"
              aria-label={t("Đóng")}
              onClick={() => {
                setVersionDetailTarget(null);
                setVersionDiff(null);
                setVersionDiffError("");
              }}
            >
              {t("×")}
            </button>
            <p className="form-eyebrow">{t("LỊCH SỬ PHIÊN BẢN")}</p>
            <h2 id="version-diff-title">
              {t("Thay đổi trong {{version}}", {
                version: versionDetailTarget.version,
              })}
            </h2>
            <p>
              {versionReasonLabel(versionDetailTarget.reason)} ·{" "}
              {dateLabel(versionDetailTarget.createdAt)}
            </p>
            {versionDiffLoading ? (
              <Empty>{t("Đang tải thay đổi…")}</Empty>
            ) : versionDiffError ? (
              <div className="admin-inline-error" role="alert">
                {versionDiffError}
                <button
                  className="admin-outline"
                  onClick={() => void viewVersion(versionDetailTarget)}
                >
                  {t("Thử lại")}
                </button>
              </div>
            ) : versionDiff ? (
              <>
                <div className="version-diff-summary">
                  <b>
                    {versionDiff.comparedWith
                      ? t("So với {{version}}", {
                          version: versionDiff.comparedWith,
                        })
                      : t("Phiên bản đầu tiên")}
                  </b>
                  <span>
                    {t("{{count}} tệp thay đổi", {
                      count: versionDiff.changedFiles.length,
                    })}
                  </span>
                </div>
                <div className="changed-file-list">
                  {versionDiff.changedFiles.map((file) => (
                    <span key={file.path}>
                      <b>{t(file.change)}</b>
                      {file.path}
                    </span>
                  ))}
                </div>
                {versionDiff.diff ? (
                  <pre className="version-diff-code">{versionDiff.diff}</pre>
                ) : (
                  <Empty>{t("Không có thay đổi nội dung.")}</Empty>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
      {rollbackTarget && (
        <div className="admin-modal-backdrop">
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rollback-title"
          >
            <h2 id="rollback-title">
              {t("Khôi phục")} {rollbackTarget.version}?
            </h2>
            <p>
              {t(
                "Nội dung bản này sẽ trở thành phiên bản mới. Kết quả quét hiện tại được làm mới; hãy quét và chạy test lại sau khi khôi phục.",
              )}
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="inline-actions">
              <button
                className="outline-button"
                disabled={Boolean(busy)}
                onClick={() => setRollbackTarget(null)}
              >
                {t("Hủy")}
              </button>
              <button
                className="primary-button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void performAction(
                    "Đang khôi phục…",
                    (id, signal) =>
                      apiFetch(
                        `/projects/${id}/rollback?version=${encodeURIComponent(rollbackTarget.version)}`,
                        { signal, method: "POST" },
                      ),
                    "Đã khôi phục nội dung thành phiên bản mới. Hãy quét và chạy test lại.",
                    "versions",
                  ).then((success) => {
                    if (success) setRollbackTarget(null);
                  })
                }
              >
                {busy || t("Khôi phục")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
