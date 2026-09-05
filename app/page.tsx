"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, errorMessage, isAborted } from "../lib/api";
import { useSession } from "../lib/auth";
import type { Capabilities, CodeVersion, FileContent, FixProposal, Issue, IssueStatus, Project, Severity, SourceFile, TestCase, TestRun } from "../lib/types";
import { dateLabel, Empty, highlightPython, Icon, initials, SessionGate } from "./components/ui";
import TestExplanation from "./components/test-explanation";
const severityLabel: Record<Severity, string> = {
  CRITICAL: "Nghiêm trọng",
  HIGH: "Cao",
  MEDIUM: "Trung bình",
  LOW: "Thấp"
};
const statusLabel: Record<IssueStatus, string> = {
  PENDING: "Chờ duyệt",
  ACCEPTED: "Đã chấp nhận",
  REJECTED: "Đã từ chối",
  APPLIED: "Đã áp dụng",
  VERIFIED: "Đã xác minh",
  FAILED: "Xác minh thất bại"
};
const navigation = [{
  id: "overview",
  label: "Tổng quan",
  icon: "grid"
}, {
  id: "source",
  label: "Mã nguồn",
  icon: "code"
}, {
  id: "analysis",
  label: "Phân tích",
  icon: "spark"
}, {
  id: "testing",
  label: "Kiểm thử",
  icon: "flask"
}, {
  id: "versions",
  label: "Phiên bản",
  icon: "clock"
}];
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
  const {
    user,
    sessionError,
    logout,
    retrySession
  } = useSession("developer");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const currentProject = useRef("");
  const requestSerial = useRef(0);
  const projectController = useRef<AbortController | null>(null);
  const actionInProgress = useRef(false);
  const [data, setData] = useState<ProjectData | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [activeNav, setActiveNav] = useState("overview");
  const [selectedFile, setSelectedFile] = useState("");
  const [content, setContent] = useState<FileContent | null>(null);
  const [fileError, setFileError] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [proposalError, setProposalError] = useState("");
  const [proposalLoading, setProposalLoading] = useState(false);
  const [filter, setFilter] = useState<Severity | "ALL">("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState<UploadSelection | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<CodeVersion | null>(null);
  const [testName, setTestName] = useState("test_project.py");
  const [testCode, setTestCode] = useState("");
  const [testEditorId, setTestEditorId] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState("");
  const [analysisMode, setAnalysisMode] = useState<"static" | "ai">("static");
  const folderInputRef = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);
  const issues = data?.issues ?? [];
  const selectedIssue = issues.find(item => item.id === selectedIssueId) ?? issues[0];
  const selectedProposal = proposal?.issueId === selectedIssue?.id ? proposal : null;
  const filteredIssues = useMemo(() => filter === "ALL" ? issues : issues.filter(item => item.severity === filter), [issues, filter]);
  const counts = useMemo(() => ({
    total: issues.length,
    critical: issues.filter(item => item.severity === "CRITICAL").length,
    accepted: issues.filter(item => item.status === "ACCEPTED").length,
    verified: issues.filter(item => item.status === "VERIFIED").length
  }), [issues]);
  const selectProject = useCallback((id: string) => {
    currentProject.current = id;
    projectController.current?.abort();
    requestSerial.current += 1;
    setProjectId(id);
    setData(null);
    setSelectedFile("");
    setSelectedIssueId("");
    setContent(null);
    setProposal(null);
    setNotice("");
    setError("");
    setFilter("ALL");
    setTestName("test_project.py");
    setTestCode("");
    setTestEditorId("");
    setShowUpload(null);
    setRollbackTarget(null);
  }, []);
  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    setListLoading(true);
    try {
      const result = await apiFetch<Project[]>("/projects", {
        signal
      });
      if (signal?.aborted) return;
      setProjects(result);
      if (!result.some(item => item.id === currentProject.current)) selectProject(result[0]?.id ?? "");
    } catch (failure) {
      if (!isAborted(failure)) setError(errorMessage(failure));
    } finally {
      if (!signal?.aborted) setListLoading(false);
    }
  }, [selectProject]);
  const refreshProject = useCallback(async (id: string) => {
    if (currentProject.current !== id) return;
    projectController.current?.abort();
    const controller = new AbortController();
    projectController.current = controller;
    const serial = ++requestSerial.current;
    const options = {
      signal: controller.signal
    };
    const base = `/projects/${encodeURIComponent(id)}`;
    setLoading(true);
    try {
      const [project, files, newIssues, tests, versions, testCases] = await Promise.all([apiFetch<Project>(base, options), apiFetch<SourceFile[]>(`${base}/files`, options), apiFetch<Issue[]>(`${base}/issues`, options), apiFetch<TestRun[]>(`${base}/test-runs`, options), apiFetch<CodeVersion[]>(`${base}/versions`, options), apiFetch<TestCase[]>(`${base}/test-cases`, options)]);
      if (currentProject.current !== id || serial !== requestSerial.current || controller.signal.aborted) return;
      setData({
        project,
        files,
        issues: newIssues,
        tests,
        versions,
        testCases
      });
      setProjects(current => current.map(item => item.id === id ? project : item));
      setSelectedFile(current => files.some(item => item.path === current) ? current : files[0]?.path ?? "");
      setSelectedIssueId(current => newIssues.some(item => item.id === current) ? current : newIssues[0]?.id ?? "");
    } catch (failure) {
      if (!isAborted(failure) && currentProject.current === id && serial === requestSerial.current) {
        setError(`Không tải được dữ liệu project: ${errorMessage(failure)}`);
      }
    } finally {
      if (currentProject.current === id && serial === requestSerial.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void loadProjects(controller.signal);
    apiFetch<Capabilities>("/capabilities", {
      signal: controller.signal
    }).then(result => {
      if (!controller.signal.aborted) setCapabilities(result);
    }).catch((failure: unknown) => {
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
    apiFetch<FileContent>(`/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(selectedFile)}`, {
      signal: controller.signal
    }).then(result => {
      if (!controller.signal.aborted && currentProject.current === projectId) setContent(result);
    }).catch((failure: unknown) => {
      if (!isAborted(failure) && currentProject.current === projectId) setFileError(errorMessage(failure));
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
      signal: controller.signal
    }).then(result => {
      if (!controller.signal.aborted && currentProject.current === projectId) setProposal(result.proposal);
    }).catch((failure: unknown) => {
      if (!isAborted(failure) && currentProject.current === projectId) setProposalError(errorMessage(failure));
    }).finally(() => {
      if (!controller.signal.aborted && currentProject.current === projectId) setProposalLoading(false);
    });
    return () => controller.abort();
  }, [selectedIssue, projectId]);
  async function performAction(label: string, action: (id: string) => Promise<unknown>, success: string) {
    const id = currentProject.current;
    if (!id || actionInProgress.current) return false;
    actionInProgress.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action(id);
      if (currentProject.current === id) {
        setNotice(success);
        await refreshProject(id);
      }
      return true;
    } catch (failure) {
      if (currentProject.current === id) setError(errorMessage(failure));
      return false;
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  function navigate(id: string) {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionInProgress.current) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;
    actionInProgress.current = true;
    setBusy("Đang tạo project…");
    setError("");
    try {
      const created = await apiFetch<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({
          name,
          language: "Python 3.12"
        })
      });
      setProjects(current => [created, ...current]);
      selectProject(created.id);
      setShowCreate(false);
      setNotice(`Đã tạo ${created.name}. Tải source để bắt đầu.`);
    } catch (failure) {
      setError(errorMessage(failure));
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
      rejectUpload(`Chỉ được chọn tối đa ${MAX_UPLOAD_FILES} tệp mỗi lần.`);
      return false;
    }
    if (selection.totalBytes > MAX_UPLOAD_BYTES) {
      rejectUpload("Tổng dung lượng tệp đã chọn vượt quá giới hạn sơ bộ 10 MB.");
      return false;
    }
    const normalizedPaths = selection.items.map(item => item.path.toLocaleLowerCase());
    if (new Set(normalizedPaths).size !== normalizedPaths.length) {
      rejectUpload("Có tệp trùng đường dẫn trong lựa chọn. Hãy đổi tên hoặc chọn lại.");
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
    if (files.some(file => !/\.(py|zip)$/i.test(file.name))) {
      rejectUpload("Chỉ hỗ trợ tệp .py hoặc .zip.");
      return;
    }
    const zipCount = files.filter(file => /\.zip$/i.test(file.name)).length;
    if (zipCount && files.length > 1) {
      rejectUpload("Không thể tải ZIP cùng các tệp khác. Hãy chọn một ZIP hoặc nhiều tệp .py.");
      return;
    }
    const items = files.map(file => ({
      file,
      path: file.name
    }));
    validateUpload({
      mode: "files",
      label: files.length === 1 ? files[0].name : `${files.length} tệp Python`,
      items,
      ignoredCount: 0,
      totalBytes: files.reduce((total, file) => total + file.size, 0)
    });
  }
  function chooseFolder(event: ChangeEvent<HTMLInputElement>) {
    const chosenFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!chosenFiles.length) {
      rejectUpload("Thư mục này không có tệp .py để tải lên.");
      return;
    }
    const pythonFiles = chosenFiles.filter(file => /\.py$/i.test(file.name));
    if (!pythonFiles.length) {
      rejectUpload("Thư mục này không có tệp .py để tải lên.");
      return;
    }
    const rawPaths = pythonFiles.map(file => (file.webkitRelativePath || file.name).replace(/\\/g, "/").split("/").filter(part => part && part !== "." && part !== "..").join("/"));
    const root = rawPaths[0]?.split("/")[0] ?? "";
    const commonRoot = Boolean(root && rawPaths.every(path => path.startsWith(`${root}/`)));
    const items = pythonFiles.map((file, index) => ({
      file,
      path: commonRoot ? rawPaths[index].slice(root.length + 1) || file.name : rawPaths[index] || file.name
    }));
    validateUpload({
      mode: "folder",
      label: commonRoot ? root : "Thư mục đã chọn",
      items,
      ignoredCount: chosenFiles.length - pythonFiles.length,
      totalBytes: pythonFiles.reduce((total, file) => total + file.size, 0)
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
    showUpload.items.forEach(item => form.append("file", item.file, item.path));
    const success = await performAction("Đang tải source…", id => apiFetch(`/projects/${id}/upload`, {
      method: "POST",
      body: form
    }), "Đã lưu source. Hãy quét để phân tích phiên bản mới.");
    if (success) setShowUpload(null);
  }
  async function reviewIssue(action: "accept" | "reject") {
    if (!selectedIssue) return;
    await performAction("Đang lưu quyết định…", () => apiFetch(`/issues/${encodeURIComponent(selectedIssue.id)}/${action}`, {
      method: "POST"
    }), action === "accept" ? "Đã chấp nhận đề xuất. Nhấn Áp dụng để thay đổi source." : "Đã từ chối đề xuất.");
  }
  async function saveTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const success = await performAction("Đang lưu test…", id => apiFetch(`/projects/${id}/test-cases`, {
      method: "POST",
      body: JSON.stringify({
        name: testName.trim(),
        code: testCode
      })
    }), "Đã lưu test case vào project.");
    if (success) setTestEditorId(testName.trim());
  }
  if (!user) return <SessionGate error={sessionError} retry={retrySession} logout={logout} />;
  const disabled = Boolean(busy || loading || !data);
  return <main className="shell connected-shell">
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><Icon name="spark" size={20} /></span>
        <span>sentinel</span>
        <small>AI CODE REVIEW</small>
      </div>
      <div className="workspace-switch">
        <span className="workspace-dot">S</span>
        <div>
          <b>Không gian Developer</b>
          <small>{projects.length} project</small>
        </div>
      </div>
      <nav aria-label="Điều hướng Developer">{navigation.map(item => <button key={item.id} title={item.label} aria-label={item.label} className={`nav-item${activeNav === item.id ? " active" : ""}`} onClick={() => navigate(item.id)}>
          <Icon name={item.icon} />
          <span className="nav-label">{item.label}</span>
        </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="security-note">
          <span>●</span>
          <div>
            <b>Quy trình có kiểm soát</b>
            <small>Duyệt trước khi áp dụng</small>
          </div>
        </div>
        <div className="profile-menu">
          <div className="profile">
            <span className="avatar">{initials(user.fullName)}</span>
            <div>
              <b>{user.fullName}</b>
              <small>Developer</small>
            </div>
          </div>
          <button className="logout-button" onClick={() => void logout()}>↪ Đăng xuất</button>
        </div>
      </div>
    </aside>

    <section className="content">
      <header className="topbar">
        <div className="project-picker">
          <label htmlFor="project-select">Project</label>
          <select id="project-select" value={projectId} disabled={Boolean(busy || listLoading)} onChange={event => selectProject(event.target.value)}>
            {!projects.length && <option value="">{listLoading ? "Đang tải…" : "Chưa có project"}</option>}
            {projects.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
          <button className="outline-button" onClick={() => setShowCreate(true)} disabled={Boolean(busy)}>＋ Tạo project</button>
        </div>
        <div className="top-actions">
          <button className="outline-button" disabled={disabled || !data?.files.length} onClick={() => void performAction("Đang quét…", id => apiFetch(`/projects/${id}/${analysisMode === "ai" ? "ai-scan" : "scan"}`, {
            method: "POST"
          }), "Quét hoàn tất. Kết quả được lấy từ source đang lưu.")}>
            <Icon name="spark" size={16} />
            {analysisMode === "ai" ? "Quét bằng AI" : "Quét source"}
          </button>
          <label className={`outline-button upload-label${disabled ? " is-disabled" : ""}`} aria-disabled={disabled}>
            <Icon name="upload" size={16} />
            Tải tệp
            <input type="file" accept=".zip,.py" multiple onChange={chooseFiles} disabled={disabled} aria-label="Tải một hoặc nhiều tệp Python, hoặc một tệp ZIP" />
          </label>
          <label className={`primary-button upload-label${disabled ? " is-disabled" : ""}`} aria-disabled={disabled}>
            <Icon name="folder" size={16} />
            Tải thư mục
            <input ref={folderInputRef} type="file" accept=".py" multiple onChange={chooseFolder} disabled={disabled} aria-label="Tải toàn bộ thư mục mã nguồn Python" />
          </label>
        </div>
      </header>
      {busy && <div className="toast" role="status">{busy}</div>}
      {error && <div className="toast toast-error" role="alert">
        <span>{error}</span>
        <button onClick={() => {
          setError("");
          if (projectId) void refreshProject(projectId);else void loadProjects();
        }}>Tải lại</button>
      </div>}
      {notice && <div className="toast" role="status">{notice}</div>}
      <div className="project-head" id="overview">
        <div>
          <div className="eyebrow">PHÂN TÍCH MÃ PYTHON</div>
          <h1>{data?.project.name || (loading || listLoading ? "Đang tải project…" : "Bắt đầu với project đầu tiên")}</h1>
          <p>{data ? `${data.project.language} · ${data.project.version} · Cập nhật ${dateLabel(data.project.updatedAt)}` : "Tạo project, tải source và duyệt các đề xuất sửa."}</p>
        </div>
        {data && <span className="version">{data.project.version}</span>}
      </div>
      {!data && !loading && !listLoading && !error && <div className="panel onboarding">
        <h2>Không gian làm việc của bạn</h2>
        <p>Mỗi project có mã nguồn, lịch sử kiểm thử và phiên bản riêng.</p>
        <button className="primary-button" onClick={() => setShowCreate(true)}>＋ Tạo project</button>
      </div>}
      {data && <>
        <section className="stat-grid" aria-label="Tổng quan kết quả">
          <article>
            <div className="stat-label">VẤN ĐỀ PHÁT HIỆN</div>
            <strong>{counts.total}</strong>
            <small>Kết quả lần quét hiện tại</small>
          </article>
          <article className="critical">
            <div className="stat-label">NGHIÊM TRỌNG</div>
            <strong>{counts.critical}</strong>
            <small>Cần xem xét ưu tiên</small>
          </article>
          <article>
            <div className="stat-label">CHỜ ÁP DỤNG</div>
            <strong>{counts.accepted}</strong>
            <small>Đề xuất đã được chấp nhận</small>
          </article>
          <article className="good">
            <div className="stat-label">ĐÃ XÁC MINH</div>
            <strong>{counts.verified}</strong>
            <small>Theo kết quả kiểm thử</small>
          </article>
        </section>
        <div className="analysis-controls">
          <label>Chế độ phân tích<select value={analysisMode} disabled={disabled} onChange={event => setAnalysisMode(event.target.value as "static" | "ai")}>
              <option value="static">Quy tắc tĩnh</option>
              {capabilities?.aiConfigured && <option value="ai">AI</option>}
            </select></label>
          <p className="engine-note">{capabilities?.aiConfigured ? "AI chỉ nhận source từ project khi bạn bấm thao tác AI. Nội dung được gửi tới dịch vụ AI đã cấu hình; cần review đề xuất trước khi áp dụng." : capabilities ? "AI chưa được cấu hình. Bạn vẫn có thể dùng bộ phân tích quy tắc tĩnh; các chỉ số AI chưa có dữ liệu đo." : "Đang kiểm tra cấu hình AI. Bộ phân tích quy tắc tĩnh vẫn khả dụng."}</p>
          {capabilityError && <p className="error-text">Không đọc được cấu hình AI: {capabilityError}</p>}
        </div>
        <section className="review-layout" id="source" aria-busy={loading}>
          <article className="panel file-panel">
            <div className="panel-title"><div>
                <b>Mã nguồn</b>
                <small>{data.files.length} tệp</small>
              </div></div>
            <div className="file-list">
              {data.files.map(file => <button className={`file-row${selectedFile === file.path ? " selected" : ""}`} key={file.id} title={file.path} onClick={() => setSelectedFile(file.path)}>
                <span className="py-icon">PY</span>
                <span>{file.path}</span>
              </button>)}
              {!data.files.length && <Empty>Tải tệp .py, .zip hoặc cả thư mục để bắt đầu.</Empty>}
            </div>
          </article>
          <article className="panel code-panel">
            <div className="panel-title">
              <div className="file-title">
                <span className="py-icon">PY</span>
                <b>{selectedFile || "Chưa chọn tệp"}</b>
              </div>
              <small>UTF-8</small>
            </div>
            {fileError ? <Empty>{fileError}</Empty> : content && content.path === selectedFile ? <pre className="code-view">{content.content.split("\n").map((line, index) => <div className={`code-line${selectedFile === selectedIssue?.filePath && index + 1 >= selectedIssue.lineStart && index + 1 <= selectedIssue.lineEnd ? " flagged" : ""}`} key={index}>
                <span>{index + 1}</span>
                <code>{highlightPython(line || " ")}</code>
              </div>)}</pre> : <Empty>{selectedFile ? "Đang tải mã nguồn…" : "Chưa có mã nguồn."}</Empty>}
            <div className="code-footer">
              <span>Python</span>
              <span>{content ? `${content.content.split("\n").length} dòng` : "—"}</span>
            </div>
          </article>
          <article className="panel issue-panel" id="analysis">
            <div className="panel-title">
              <div>
                <b>Kết quả phân tích</b>
                <small>{filteredIssues.length} vấn đề</small>
              </div>
              <select className="filter-button" value={filter} aria-label="Lọc mức độ lỗi" onChange={event => setFilter(event.target.value as Severity | "ALL")}>
                <option value="ALL">Tất cả</option>
                {Object.entries(severityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="issue-list">
              {filteredIssues.map(issue => <button className={`issue-card${selectedIssue?.id === issue.id ? " selected" : ""}`} key={issue.id} onClick={() => {
                setSelectedIssueId(issue.id);
                setSelectedFile(issue.filePath);
                setActiveNav("analysis");
              }}>
                <div className="issue-top">
                  <span className={`severity ${issue.severity.toLowerCase()}`}>{severityLabel[issue.severity]}</span>
                  <span>{issue.ruleCode}</span>
                </div>
                <b>{issue.type}</b>
                <p>{issue.description}</p>
                <small>{issue.filePath} : {issue.lineStart}<br /><span className={`status ${issue.status.toLowerCase()}`}>{statusLabel[issue.status]}</span></small>
              </button>)}
              {!filteredIssues.length && <Empty>{issues.length ? "Không có vấn đề ở mức đã chọn." : "Danh sách hiện tại chưa có vấn đề. Nhấn Quét source để cập nhật phân tích."}</Empty>}
            </div>
          </article>
        </section>
        <section className="details-grid">
          <article className="panel proposal-panel">
            <div className="panel-title">
              <div>
                <b>Review đề xuất sửa</b>
                {selectedIssue && <h2>{selectedIssue.type}</h2>}
              </div>
              {selectedIssue && <span className="confidence">{selectedIssue.confidence == null ? "Độ tin cậy: chưa đo" : `Độ tin cậy ${Math.round(selectedIssue.confidence * 100)}%`}</span>}
            </div>
            {selectedIssue ? <>
              <p className="issue-summary">{selectedIssue.explanation}</p>
              <p className="issue-summary"><b>Ảnh hưởng:</b> {selectedIssue.impact}</p>
              <div className="location">
                <Icon name="code" size={16} />
                <b>{selectedIssue.filePath}</b>
                <span>Dòng {selectedIssue.lineStart}–{selectedIssue.lineEnd}</span>
                <span>{selectedIssue.ruleCode}</span>
              </div>
              {proposalLoading ? <Empty>Đang tải đề xuất…</Empty> : proposalError ? <Empty>{proposalError}</Empty> : selectedProposal ? <>
                <div className="diff-head">
                  <b>So sánh trước / sau</b>
                  <span>Đề xuất cần được review và kiểm thử</span>
                </div>
                <div className="diff">
                  <div>
                    <label>− TRƯỚC</label>
                    <pre>{selectedProposal.originalCode}</pre>
                  </div>
                  <div>
                    <label>+ SAU</label>
                    <pre>{selectedProposal.replacementCode}</pre>
                  </div>
                </div>
                <p className="reason"><b>Lý do:</b> {selectedProposal.reason}</p>
              </> : <div className="empty-proposal">Chưa có đề xuất sửa tự động an toàn cho vấn đề này. Cần review và sửa thủ công.{capabilities?.aiConfigured && selectedIssue.status === "PENDING" && <button className="run-button ai-proposal-button" disabled={disabled} onClick={() => void performAction("Đang tạo đề xuất bằng AI…", () => apiFetch(`/issues/${encodeURIComponent(selectedIssue.id)}/ai-proposal`, {
                  method: "POST"
                }), "Đã nhận đề xuất AI. Review diff và chạy test sau khi áp dụng.")}>Lấy đề xuất AI cho vấn đề này</button>}</div>}
              <div className="review-actions">
                <span className="decision">{statusLabel[selectedIssue.status]}</span>
                {selectedIssue.status === "PENDING" && <>
                  <button className="reject-button" disabled={disabled} onClick={() => void reviewIssue("reject")}><Icon name="x" size={16} />Từ chối</button>
                  <button className="accept-button" disabled={disabled || !selectedProposal || proposalLoading} onClick={() => void reviewIssue("accept")}><Icon name="check" size={16} />Chấp nhận</button>
                </>}
                {selectedIssue.status === "ACCEPTED" && <button className="reject-button" disabled={disabled} onClick={() => void reviewIssue("reject")}>Đổi sang từ chối</button>}
              </div>
            </> : <Empty>Chọn một vấn đề sau khi quét để xem đề xuất.</Empty>}
            <div className="apply-section">
              <div>
                <b>{counts.accepted} đề xuất đang chờ áp dụng</b>
                <small>Lưu phiên bản trước khi thay đổi source. Sau đó cần chạy test để xác minh.</small>
              </div>
              <button className="primary-button" disabled={disabled || counts.accepted === 0} onClick={() => void performAction("Đang áp dụng patch…", id => apiFetch(`/projects/${id}/apply`, {
                method: "POST"
              }), "Đã áp dụng các đề xuất được chấp nhận và lưu phiên bản. Hãy chạy test để xác minh.")}>Áp dụng ({counts.accepted})</button>
            </div>
          </article>
          <aside className="side-stack"><article className="panel test-panel" id="testing">
              <div className="panel-title">
                <div>
                  <b>Kiểm thử & xác minh</b>
                  <small>Kết quả thực thi từ backend</small>
                </div>
                <button className="run-button" disabled={disabled || !data.files.length} onClick={() => void performAction("Đang chạy test trong sandbox…", id => apiFetch(`/projects/${id}/test`, {
                  method: "POST"
                }), "Đã nhận kết quả kiểm thử. Xem trạng thái và log bên dưới.")}><Icon name="play" size={14} />Chạy test</button>
              </div>
              {data.tests.map(run => <div className="test-result" key={run.id}>
                <div className="test-run">
                  <span className={`run-icon ${run.status === "PASS" ? "pass-icon" : "fail-icon"}`}>{run.status === "PASS" ? "✓" : "!"}</span>
                  <div>
                    <b>{run.version} · {run.status}</b>
                    <small>{run.passed}/{run.total} đạt · {run.failed} lỗi · {run.errors} lỗi thực thi · {run.duration}</small>
                  </div>
                  <span>{dateLabel(run.createdAt)}</span>
                </div>
                {run.output && <details className="test-output">
                  <summary>Xem log kiểm thử</summary>
                  <pre>{run.output}</pre>
                  {capabilities?.aiConfigured && <TestExplanation projectId={projectId} runId={run.id} />}
                </details>}
              </div>)}
              {!data.tests.length && <Empty>Chưa có lượt kiểm thử. Chạy test trước khi Apply để ghi nhận baseline và chạy lại sau khi sửa.</Empty>}
              <p className="form-help panel-help">Nếu sandbox chưa sẵn sàng, hệ thống sẽ báo lỗi và không tạo kết quả giả.</p>
              <form className="test-case-form" onSubmit={saveTest}>
                <h3>Bộ test pytest</h3>
                {capabilities?.aiConfigured && <>
                  <button type="button" className="run-button" disabled={disabled || !data.files.length} onClick={() => void performAction("Đang sinh test bằng AI…", id => apiFetch(`/projects/${id}/test-cases/generate`, {
                    method: "POST"
                  }), "Đã lưu các test do AI tạo. Kiểm tra nội dung trước khi chạy.")}>Sinh test bằng AI từ source</button>
                  <small className="form-help">Bấm để gửi source tới dịch vụ AI đã cấu hình.</small>
                </>}
                <label>Test đã lưu<select value={testEditorId} disabled={Boolean(busy)} onChange={event => {
                    const chosen = data.testCases.find(item => item.name === event.target.value);
                    setTestEditorId(event.target.value);
                    setTestName(chosen?.name ?? "test_project.py");
                    setTestCode(chosen?.code ?? "");
                  }}>
                    <option value="">＋ Test mới</option>
                    {data.testCases.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
                  </select></label>
                <label>Tên tệp test<input required value={testName} onChange={event => setTestName(event.target.value)} placeholder="test_project.py" pattern="test_[A-Za-z0-9_]+\.py" title="Tên dạng test_ten.py" disabled={Boolean(busy)} /></label>
                <label>Nội dung pytest<textarea required value={testCode} onChange={event => setTestCode(event.target.value)} rows={8} spellCheck={false} placeholder={"from calculator import divide\n\ndef test_divide():\n    assert divide(6, 2) == 3"} disabled={Boolean(busy)} /></label>
                <button className="outline-button" disabled={disabled || !testCode.trim()} type="submit">Lưu test case</button>
              </form>
            </article>
            <article className="panel version-panel" id="versions">
              <div className="panel-title"><div>
                  <b>Lịch sử phiên bản</b>
                  <small>Hiện tại: {data.project.version}</small>
                </div></div>
              <div className="timeline">{data.versions.map(version => <div key={version.id}>
                  <span className={`timeline-node${version.version === data.project.version ? " current" : ""}`} />
                  <b>
                    {version.version}
                    {version.version === data.project.version && <small>Hiện tại</small>}
                  </b>
                  <p>{dateLabel(version.createdAt)}</p>
                  {version.version !== data.project.version && <button className="version-restore" disabled={disabled} onClick={() => setRollbackTarget(version)}>Khôi phục nội dung {version.version}</button>}
                </div>)}</div>
              {!data.versions.length && <Empty>Phiên bản đầu tiên sẽ được tạo khi tải source.</Empty>}
              <p className="form-help panel-help">Khôi phục tạo một phiên bản mới từ nội dung đã chọn và giữ lịch sử cũ.</p>
            </article>
          </aside>
        </section>
      </>}
    </section>
    {showCreate && <div className="admin-modal-backdrop"><form className="admin-modal" onSubmit={createProject} role="dialog" aria-modal="true" aria-labelledby="create-project-title">
        <button type="button" className="modal-close" aria-label="Đóng" disabled={Boolean(busy)} onClick={() => setShowCreate(false)}>×</button>
        <h2 id="create-project-title">Tạo project Python</h2>
        <label>Tên project<input name="name" required maxLength={255} autoFocus placeholder="Ví dụ: Payment API" disabled={Boolean(busy)} /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="admin-primary" disabled={Boolean(busy)} type="submit">{busy || "Tạo project"}</button>
      </form></div>}
    {showUpload && <div className="admin-modal-backdrop"><div className="admin-modal upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" aria-describedby="upload-description">
        <button type="button" className="modal-close" aria-label="Đóng cửa sổ tải source" disabled={Boolean(busy)} onClick={closeUpload}>×</button>
        <h2 id="upload-title">Tải {showUpload.mode === "folder" ? `thư mục ${showUpload.label}` : showUpload.label}</h2>
        <p>Đã chọn {showUpload.items.length} tệp ({formatBytes(showUpload.totalBytes)}). {showUpload.ignoredCount > 0 ? `Đã bỏ qua ${showUpload.ignoredCount} tệp không phải Python.` : ""}</p>
        <ul className="upload-preview" aria-label="Các tệp sẽ được tải lên">
          {showUpload.items.slice(0, UPLOAD_PREVIEW_LIMIT).map(item => <li key={item.path}>{item.path}</li>)}
        </ul>
        {showUpload.items.length > UPLOAD_PREVIEW_LIMIT && <p className="upload-more">Và {showUpload.items.length - UPLOAD_PREVIEW_LIMIT} tệp khác…</p>}
        <p id="upload-description">Thao tác này sẽ thay toàn bộ source đang lưu của project {data?.project.name}. Những phiên bản cũ vẫn được giữ để khôi phục.</p>
        <p>Các kết quả quét và quyết định review hiện tại sẽ được làm mới theo source mới.</p>
        <p className="upload-limit">Giới hạn kiểm tra sơ bộ: 500 tệp, tổng 10 MB. Máy chủ sẽ kiểm tra lại trước khi lưu.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="inline-actions">
          <button className="outline-button" disabled={Boolean(busy)} onClick={closeUpload}>Hủy</button>
          <button className="primary-button" disabled={Boolean(busy)} onClick={() => void upload()}>{busy || "Tải và thay source"}</button>
        </div>
      </div></div>}
    {rollbackTarget && <div className="admin-modal-backdrop"><div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="rollback-title">
        <h2 id="rollback-title">Khôi phục {rollbackTarget.version}?</h2>
        <p>Nội dung bản này sẽ trở thành phiên bản mới. Kết quả quét hiện tại được làm mới; hãy quét và chạy test lại sau khi khôi phục.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="inline-actions">
          <button className="outline-button" disabled={Boolean(busy)} onClick={() => setRollbackTarget(null)}>Hủy</button>
          <button className="primary-button" disabled={Boolean(busy)} onClick={() => void performAction("Đang khôi phục…", id => apiFetch(`/projects/${id}/rollback?version=${encodeURIComponent(rollbackTarget.version)}`, {
            method: "POST"
          }), "Đã khôi phục nội dung thành phiên bản mới. Hãy quét và chạy test lại.").then(success => {
            if (success) setRollbackTarget(null);
          })}>{busy || "Khôi phục"}</button>
        </div>
      </div></div>}
  </main>;
}
