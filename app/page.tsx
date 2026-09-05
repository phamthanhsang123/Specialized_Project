"use client";
import { t } from "../lib/i18n";
import { useTranslation } from "react-i18next";

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
  Severity,
  SourceFile,
  TestCase,
  TestRun,
} from "../lib/types";
import {
  dateLabel,
  Empty,
  highlightPython,
  Icon,
  initials,
  SessionGate,
} from "./components/ui";
import { LanguageSwitcher } from "./components/language-switcher";
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
const navigation = [
  { id: "projects", label: "Dự án của tôi", icon: "folder" },
  { id: "source", label: "Mã nguồn", icon: "code" },
  { id: "analysis", label: "Vấn đề & bản sửa", icon: "spark" },
  { id: "testing", label: "Kiểm thử", icon: "flask" },
  { id: "versions", label: "Lịch sử", icon: "clock" },
];
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [selectedFile, setSelectedFile] = useState("");
  const [content, setContent] = useState<FileContent | null>(null);
  const [fileError, setFileError] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [proposalError, setProposalError] = useState("");
  const [proposalLoading, setProposalLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [issueSearch, setIssueSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "ALL">("ALL");
  const [reviewTab, setReviewTab] = useState("explanation");
  const [filter, setFilter] = useState<Severity | "ALL">("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState<UploadSelection | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<CodeVersion | null>(
    null,
  );
  const [testName, setTestName] = useState("test_project.py");
  const [testCode, setTestCode] = useState("");
  const [testEditorId, setTestEditorId] = useState("");
  const [testBaseline, setTestBaseline] = useState({
    name: "test_project.py",
    code: "",
  });
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
    () =>
      issues.filter(
        (item) =>
          (filter === "ALL" || item.severity === filter) &&
          (statusFilter === "ALL" || item.status === statusFilter) &&
          `${item.type} ${item.description} ${item.filePath}`
            .toLocaleLowerCase()
            .includes(issueSearch.toLocaleLowerCase()),
      ),
    [issues, filter, statusFilter, issueSearch],
  );
  const selectedIssue =
    filteredIssues.find((item) => item.id === selectedIssueId) ??
    filteredIssues[0];
  const selectedProposal =
    proposal?.issueId === selectedIssue?.id ? proposal : null;
  const counts = useMemo(
    () => ({
      total: issues.length,
      critical: issues.filter((item) => item.severity === "CRITICAL").length,
      accepted: issues.filter((item) => item.status === "ACCEPTED").length,
      verified: issues.filter((item) => item.status === "VERIFIED").length,
    }),
    [issues],
  );
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
      setStatusFilter("ALL");
      setIssueSearch("");
      setReviewTab("explanation");
      setTestName("test_project.py");
      setTestCode("");
      setTestEditorId("");
      setTestBaseline({ name: "test_project.py", code: "" });
      setShowUpload(null);
      setRollbackTarget(null);
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
  const refreshProject = useCallback(async (id: string) => {
    if (currentProject.current !== id) return false;
    projectController.current?.abort();
    const controller = new AbortController();
    projectController.current = controller;
    const serial = ++requestSerial.current;
    const options = {
      signal: controller.signal,
    };
    const base = `/projects/${encodeURIComponent(id)}`;
    setLoading(true);
    try {
      const [project, files, newIssues, tests, versions, testCases] =
        await Promise.all([
          apiFetch<Project>(base, options),
          apiFetch<SourceFile[]>(`${base}/files`, options),
          apiFetch<Issue[]>(`${base}/issues`, options),
          apiFetch<TestRun[]>(`${base}/test-runs`, options),
          apiFetch<CodeVersion[]>(`${base}/versions`, options),
          apiFetch<TestCase[]>(`${base}/test-cases`, options),
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
      if (currentProject.current === id && serial === requestSerial.current)
        setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void loadProjects(controller.signal);
    apiFetch<Capabilities>("/capabilities", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setCapabilities(result);
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
    setContent(null);
    setFileError("");
    if (!selectedFile || !data || data.project.id !== projectId) return;
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
  }, [selectedFile, projectId, data]);
  useEffect(() => {
    setProposal(null);
    setProposalError("");
    setProposalLoading(false);
    if (!selectedIssue) return;
    const controller = new AbortController();
    setProposalLoading(true);
    apiFetch<{
      issue: Issue;
      proposal: FixProposal | null;
    }>(`/issues/${encodeURIComponent(selectedIssue.id)}`, {
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
  }, [selectedIssue, projectId]);
  async function performAction(
    label: string,
    action: (id: string, signal: AbortSignal) => Promise<unknown>,
    success: string,
  ) {
    const id = currentProject.current;
    if (!id || actionInProgress.current || stale || uncertain) return false;
    const controller = new AbortController();
    actionController.current = controller;
    actionInProgress.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    setRecovery("");
    try {
      await action(id, controller.signal);
      if (currentProject.current === id) {
        const fresh = await refreshProject(id);
        if (fresh) setNotice(success);
        else
          setRecovery(
            "Thao tác đã được lưu, nhưng chưa tải được dữ liệu mới. Hãy tải lại dữ liệu; không gửi lại thao tác.",
          );
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
      setBusy("");
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
    if (files.some((file) => !/\.(py|zip)$/i.test(file.name))) {
      rejectUpload(t("Chỉ hỗ trợ tệp .py hoặc .zip."));
      return;
    }
    const zipCount = files.filter((file) => /\.zip$/i.test(file.name)).length;
    if (zipCount && files.length > 1) {
      rejectUpload(
        t(
          "Không thể tải ZIP cùng các tệp khác. Hãy chọn một ZIP hoặc nhiều tệp .py.",
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
          : t("{{v0}} tệp Python", { v0: files.length }),
      items,
      ignoredCount: 0,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
    });
  }
  function chooseFolder(event: ChangeEvent<HTMLInputElement>) {
    const chosenFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!chosenFiles.length) {
      rejectUpload(t("Thư mục này không có tệp .py để tải lên."));
      return;
    }
    const pythonFiles = chosenFiles.filter((file) => /\.py$/i.test(file.name));
    if (!pythonFiles.length) {
      rejectUpload(t("Thư mục này không có tệp .py để tải lên."));
      return;
    }
    const rawPaths = pythonFiles.map((file) =>
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
    const items = pythonFiles.map((file, index) => ({
      file,
      path: commonRoot
        ? rawPaths[index].slice(root.length + 1) || file.name
        : rawPaths[index] || file.name,
    }));
    validateUpload({
      mode: "folder",
      label: commonRoot ? root : t("Thư mục đã chọn"),
      items,
      ignoredCount: chosenFiles.length - pythonFiles.length,
      totalBytes: pythonFiles.reduce((total, file) => total + file.size, 0),
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
    );
    if (success) setShowUpload(null);
  }
  async function reviewIssue(action: "accept" | "reject") {
    if (!selectedIssue) return;
    await performAction(
      "Đang lưu quyết định…",
      (id, signal) =>
        apiFetch(`/issues/${encodeURIComponent(selectedIssue.id)}/${action}`, {
          signal,
          method: "POST",
        }),
      action === "accept"
        ? "Đã chấp nhận đề xuất. Nhấn Áp dụng để thay đổi source."
        : "Đã từ chối đề xuất.",
    );
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
  useDialog(
    showCreate || Boolean(showUpload) || Boolean(rollbackTarget),
    Boolean(busy),
    () => {
      setShowCreate(false);
      setShowUpload(null);
      setRollbackTarget(null);
      setError("");
    },
  );
  if (!user)
    return (
      <SessionGate error={sessionError} retry={retrySession} logout={logout} />
    );
  const disabled = Boolean(busy || loading || !data || stale || uncertain);
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
              <small>Developer</small>
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
      <section className="content" ref={viewport}>
        <header className="workspace-header">
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
          <LanguageSwitcher />
        </header>
        {busy && (
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
                    "Chọn dự án để tiếp tục, hoặc tạo dự án mới để phân tích mã Python.",
                  )}
                </p>
              </div>
              <button
                className="primary-button"
                disabled={Boolean(busy) || uncertain}
                onClick={() => setShowCreate(true)}
              >
                {t("＋ Tạo dự án")}
              </button>
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
              <Empty>{t("Đang tải dự án…")}</Empty>
            ) : !projects.length ? (
              <div className="panel welcome-card">
                <Icon name="folder" size={40} />
                <h2>{t("Tạo dự án đầu tiên")}</h2>
                <p>
                  {t(
                    "Tải mã nguồn Python, phân tích vấn đề và duyệt bản sửa trong một quy trình rõ ràng.",
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
                    <button
                      className="project-card"
                      key={p.id}
                      disabled={Boolean(busy) || uncertain}
                      onClick={() => selectProject(p.id)}
                    >
                      <span className="project-card-icon">
                        <Icon name="folder" size={24} />
                      </span>
                      <span className="project-card-title">{p.name}</span>
                      <span className="project-meta">
                        {p.language} · {p.version}
                      </span>
                      <span className="project-meta">
                        {dateLabel(p.updatedAt)}
                      </span>
                      <span className="project-open">{t("Mở dự án →")}</span>
                    </button>
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
            <div className="page-heading">
              <div>
                <p className="eyebrow">{data?.project.name}</p>
                <h1>
                  {t(navigation.find((n) => n.id === activeNav)?.label ?? "")}
                </h1>
                <p>
                  {activeNav === "source"
                    ? t("Tải và kiểm tra mã nguồn trước khi bắt đầu phân tích.")
                    : activeNav === "analysis"
                      ? t(
                          "Đọc giải thích, duyệt bản sửa, sau đó áp dụng các đề xuất đã chấp nhận.",
                        )
                      : activeNav === "testing"
                        ? t(
                            "Chạy bộ test trước và sau bản sửa để phát hiện thay đổi ngoài ý muốn.",
                          )
                        : t("Xem các phiên bản đã lưu và khôi phục khi cần.")}
                </p>
              </div>
            </div>
            <nav
              className="workflow-tabs"
              aria-label={t("Các bước trong dự án")}
            >
              {navigation.slice(1).map((item, index) => (
                <button
                  key={item.id}
                  disabled={Boolean(busy)}
                  aria-current={activeNav === item.id ? "step" : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <span>{index + 1}</span>
                  {t(item.label)}
                </button>
              ))}
            </nav>
            {loading && <Empty>{t("Đang tải dữ liệu dự án…")}</Empty>}
            {data && (
              <>
                {activeNav === "source" && (
                  <>
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
                            accept=".zip,.py"
                            multiple
                            onChange={chooseFiles}
                            disabled={disabled}
                            aria-label={t(
                              "Tải một hoặc nhiều tệp Python, hoặc một tệp ZIP",
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
                            accept=".py"
                            multiple
                            onChange={chooseFolder}
                            disabled={disabled}
                            aria-label={t(
                              "Tải toàn bộ thư mục mã nguồn Python",
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
                        onClick={() =>
                          void performAction(
                            "Đang quét…",
                            (id, signal) =>
                              apiFetch(
                                `/projects/${id}/${analysisMode === "ai" ? "ai-scan" : "scan"}`,
                                { signal, method: "POST" },
                              ),
                            "Quét hoàn tất. Kết quả được lấy từ source đang lưu.",
                          ).then((ok) => {
                            if (ok) setActiveNav("analysis");
                          })
                        }
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
                              <span className="py-icon">PY</span>
                              <span>{file.path}</span>
                            </button>
                          ))}
                          {!data.files.length && (
                            <Empty>
                              {t(
                                "Tải tệp .py, .zip hoặc cả thư mục để bắt đầu.",
                              )}
                            </Empty>
                          )}
                        </div>
                      </article>
                      <article className="panel code-panel">
                        <div className="panel-title">
                          <div className="file-title">
                            <span className="py-icon">PY</span>
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
                  </>
                )}
                {activeNav === "analysis" && (
                  <>
                    <div className="issue-filters">
                      <label className="search-field">
                        <input
                          placeholder={t("Tìm vấn đề hoặc đường dẫn…")}
                          aria-label={t("Tìm vấn đề")}
                          value={issueSearch}
                          onChange={(e) => setIssueSearch(e.target.value)}
                        />
                      </label>
                      <label>
                        {t("Trạng thái")}
                        <select
                          value={statusFilter}
                          onChange={(e) =>
                            setStatusFilter(
                              e.target.value as IssueStatus | "ALL",
                            )
                          }
                        >
                          <option value="ALL">{t("Tất cả")}</option>
                          {Object.entries(statusLabel).map(([value, label]) => (
                            <option key={value} value={value}>
                              {t(label)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
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
                          {filteredIssues.map((issue) => (
                            <button
                              className={`issue-card${selectedIssue?.id === issue.id ? " selected" : ""}`}
                              key={issue.id}
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
                              <b>{issue.type}</b>
                              <p>{issue.description}</p>
                              <small>
                                {issue.filePath} : {issue.lineStart}
                                <br />
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
                      <article className="panel proposal-panel">
                        <div className="panel-title">
                          <div>
                            <b>{t("Review đề xuất sửa")}</b>
                            {selectedIssue && <h2>{selectedIssue.type}</h2>}
                          </div>
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
                                {t("Giải thích")}
                              </button>
                              <button
                                role="tab"
                                aria-selected={reviewTab === "diff"}
                                onClick={() => setReviewTab("diff")}
                              >
                                {t("So sánh bản sửa")}
                              </button>
                              <button
                                className="text-link"
                                onClick={() => {
                                  setSelectedFile(selectedIssue.filePath);
                                  navigate("source");
                                }}
                              >
                                {t("Xem mã nguồn →")}
                              </button>
                            </div>
                            <div hidden={reviewTab !== "explanation"}>
                              <p className="issue-summary">
                                {selectedIssue.explanation}
                              </p>
                              <p className="issue-summary">
                                <b>{t("Ảnh hưởng:")}</b> {selectedIssue.impact}
                              </p>
                              <details className="technical-details">
                                <summary>{t("Chi tiết kỹ thuật")}</summary>
                                <p>
                                  {selectedIssue.confidence == null
                                    ? t("Độ tin cậy: chưa đo")
                                    : `${Math.round(selectedIssue.confidence * 100)}%`}
                                </p>
                                <div className="location">
                                  <Icon name="code" size={16} />
                                  <b>{selectedIssue.filePath}</b>
                                  <span>
                                    {t("Dòng")} {selectedIssue.lineStart}–
                                    {selectedIssue.lineEnd}
                                  </span>
                                  <span>{selectedIssue.ruleCode}</span>
                                </div>
                              </details>
                            </div>
                            <div hidden={reviewTab !== "diff"}>
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
                                    {selectedProposal.reason}
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
                                          )
                                        }
                                      >
                                        {t("Lấy đề xuất AI cho vấn đề này")}
                                      </button>
                                    )}
                                </div>
                              )}
                            </div>
                            <div className="review-actions">
                              <span className="decision">
                                {t(statusLabel[selectedIssue.status])}
                              </span>
                              {selectedIssue.status === "PENDING" && (
                                <>
                                  <button
                                    className="reject-button"
                                    disabled={disabled}
                                    onClick={() => void reviewIssue("reject")}
                                  >
                                    <Icon name="x" size={16} />
                                    {t("Từ chối")}
                                  </button>
                                  <button
                                    className="accept-button"
                                    title={
                                      !selectedProposal
                                        ? t(
                                            "Cần có đề xuất sửa trước khi chấp nhận.",
                                          )
                                        : t("Chấp nhận chưa thay đổi mã nguồn.")
                                    }
                                    disabled={
                                      disabled ||
                                      !selectedProposal ||
                                      proposalLoading
                                    }
                                    onClick={() => void reviewIssue("accept")}
                                  >
                                    <Icon name="check" size={16} />
                                    {t("Chấp nhận bản sửa")}
                                  </button>
                                </>
                              )}
                              {selectedIssue.status === "ACCEPTED" && (
                                <button
                                  className="reject-button"
                                  disabled={disabled}
                                  onClick={() => void reviewIssue("reject")}
                                >
                                  {t("Đổi sang từ chối")}
                                </button>
                              )}
                            </div>
                          </>
                        ) : (
                          <Empty>
                            {t("Chọn một vấn đề sau khi quét để xem đề xuất.")}
                          </Empty>
                        )}
                        <div className="apply-section">
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
                              ).then((ok) => {
                                if (ok) setActiveNav("testing");
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
                            )
                          }
                        >
                          <Icon name="play" size={14} />
                          {t("Chạy test")}
                        </button>
                      </div>
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
                      <form className="test-case-form" onSubmit={saveTest}>
                        <h3>
                          {t("Bộ test pytest")}
                          {testDirty && (
                            <span className="draft-badge">{t("Chưa lưu")}</span>
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
                        {data.versions.map((version) => (
                          <div key={version.id}>
                            <span
                              className={`timeline-node${version.version === data.project.version ? " current" : ""}`}
                            />
                            <b>
                              {version.version}
                              {version.version === data.project.version && (
                                <small>{t("Hiện tại")}</small>
                              )}
                            </b>
                            <p>{dateLabel(version.createdAt)}</p>
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
                        ))}
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
            <h2 id="create-project-title">{t("Tạo project Python")}</h2>
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
                ? t("Đã bỏ qua {{v0}} tệp không phải Python.", {
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
