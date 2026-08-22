"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { initialIssues, project, proposals, sourceFiles, testRuns } from "../lib/mock-data";
import type { Issue, IssueStatus, Severity } from "../lib/types";

const severityLabel: Record<Severity, string> = { CRITICAL: "Nghiêm trọng", HIGH: "Cao", MEDIUM: "Trung bình", LOW: "Thấp" };
const statusLabel: Record<IssueStatus, string> = { PENDING: "Chờ duyệt", ACCEPTED: "Đã chấp nhận", REJECTED: "Đã từ chối", APPLIED: "Đã áp dụng", VERIFIED: "Đã xác minh" };
const navItems = ["Tổng quan", "Mã nguồn", "Phân tích AI", "Kiểm thử", "Phiên bản"];
const navTargets: Record<string, string> = { "Tổng quan": "overview", "Mã nguồn": "source", "Phân tích AI": "analysis", "Kiểm thử": "testing", "Phiên bản": "versions" };

function scanPythonFiles(files: Record<string, string>): Issue[] {
  const found: Issue[] = [];
  const add = (filePath: string, lineStart: number, ruleCode: string, type: string, severity: Severity, description: string, explanation: string, impact: string) => found.push({ id: `ISS-${String(found.length + 1).padStart(3, "0")}`, filePath, lineStart, lineEnd: lineStart, ruleCode, type, severity, description, explanation, impact, confidence: 0.9, status: "PENDING" });
  Object.entries(files).forEach(([filePath, content]) => content.split("\n").forEach((line, index) => {
    const lineNo = index + 1;
    if (/SELECT.*\+|\+.*SELECT/i.test(line)) add(filePath, lineNo, "B608", "SQL Injection", "CRITICAL", "Câu truy vấn SQL được tạo bằng phép nối chuỗi với dữ liệu đầu vào.", "Dữ liệu người dùng đang được ghép trực tiếp vào câu lệnh SQL.", "Có thể làm lộ hoặc thay đổi dữ liệu trái phép.");
    if (/(API_KEY|SECRET|PASSWORD)\s*=\s*["']/.test(line)) add(filePath, lineNo, "SEC001", "Hard-coded Secret", "CRITICAL", "Phát hiện secret được viết trực tiếp trong mã nguồn.", "Khóa bí mật có thể bị lộ qua Git hoặc khi chia sẻ source.", "Có nguy cơ bị chiếm quyền truy cập dịch vụ.");
    if (/return\s+.+\/\s*[a-zA-Z_]/.test(line)) add(filePath, lineNo, "B018", "Division by Zero", "HIGH", "Biến ở mẫu số chưa được kiểm tra điều kiện bằng 0.", "Đầu vào có thể làm phát sinh ZeroDivisionError.", "API có thể trả về lỗi 500.");
    if (/^\s*except\s*:\s*$/.test(line)) add(filePath, lineNo, "B001", "Bare Except", "MEDIUM", "Dùng bare except làm che giấu lỗi không mong muốn.", "Mọi exception đều bị bắt nhưng không được phân loại.", "Khó điều tra và xử lý sự cố.");
  }));
  return found;
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z", code: "m8 9-3 3 3 3m8-6 3 3-3 3M13 5l-2 14", spark: "m12 3-1.5 5.5L5 10l5.5 1.5L12 17l1.5-5.5L19 10l-5.5-1.5L12 3z", flask: "M9 3h6m-3 0v6l5 8a3 3 0 0 1-2.6 4H9.6A3 3 0 0 1 7 17l5-8", clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z", folder: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z", chevron: "m9 18 6-6-6-6", play: "m8 5 11 7-11 7V5z", upload: "M12 16V4m0 0L8 8m4-4 4 4M5 20h14", check: "m5 12 4 4L19 6", x: "m6 6 12 12M18 6 6 18", branch: "M6 3v12a3 3 0 0 0 3 3h9m0 0-3-3m3 3-3 3M18 6a2 2 0 1 0 0 .01", search: "m21 21-4.3-4.3m1.3-5.2a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0", dots: "M5 12h.01M12 12h.01M19 12h.01"
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

function highlightPython(line: string) {
  const tokenPattern = /(#.*$)|(\"[^\"]*\"|'[^']*')|\b(import|from|def|return|if|else|try|except|raise|as|None|True|False)\b|(\b\d+\b)/g;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  line.replace(tokenPattern, (match, comment, stringLiteral, keyword, number, offset) => {
    if (offset > cursor) parts.push(line.slice(cursor, offset));
    const className = comment ? "syntax-comment" : stringLiteral ? "syntax-string" : keyword ? "syntax-keyword" : number ? "syntax-number" : "";
    parts.push(<span className={className} key={`${offset}-${match}`}>{match}</span>);
    cursor = offset + match.length;
    return match;
  });
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts.length ? parts : line;
}

export default function Home() {
  const [activeNav, setActiveNav] = useState("Tổng quan");
  const [issues, setIssues] = useState(initialIssues);
  const [selectedIssueId, setSelectedIssueId] = useState("ISS-001");
  const [selectedFile, setSelectedFile] = useState("app/auth/login.py");
  const [filter, setFilter] = useState<Severity | "ALL">("ALL");
  const [files, setFiles] = useState<Record<string, string>>(sourceFiles);
  const [isScanning, setIsScanning] = useState(false);
  const [toast, setToast] = useState("Dữ liệu demo sẵn sàng — chờ kết nối FastAPI.");
  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId) ?? issues[0] ?? initialIssues[0];
  const selectedProposal = proposals[selectedIssue.id];
  const filteredIssues = useMemo(() => filter === "ALL" ? issues : issues.filter((issue) => issue.severity === filter), [issues, filter]);
  const counts = useMemo(() => ({ total: issues.length, critical: issues.filter((i) => i.severity === "CRITICAL").length, accepted: issues.filter((i) => i.status === "ACCEPTED" || i.status === "APPLIED" || i.status === "VERIFIED").length, pending: issues.filter((i) => i.status === "PENDING").length }), [issues]);

  function updateStatus(id: string, status: IssueStatus) {
    setIssues((current) => current.map((issue) => issue.id === id ? { ...issue, status } : issue));
    setToast(status === "ACCEPTED" ? `Đã chấp nhận đề xuất ${id}.` : `Đã từ chối đề xuất ${id}.`);
  }
  function scanProject() {
    setIsScanning(true); setToast("AI Engine đang phân tích AST, Ruff và Bandit…");
    window.setTimeout(() => { const detected = scanPythonFiles(files); setIssues(detected); setSelectedIssueId(detected[0]?.id ?? ""); setIsScanning(false); setToast(detected.length ? `Hoàn tất quét: phát hiện ${detected.length} vấn đề từ source hiện tại.` : "Quét hoàn tất: chưa phát hiện rule nào trong source hiện tại."); }, 900);
  }
  async function uploadProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".py")) { setToast("Demo hiện đọc trực tiếp tệp .py. Upload ZIP sẽ do API của TV2 xử lý khi backend sẵn sàng."); return; }
    const content = await file.text(); const filePath = `upload/${file.name}`;
    setFiles((current) => ({ ...current, [filePath]: content })); setSelectedFile(filePath); setToast(`Đã tải ${file.name}. Nhấn “Quét lại” để phân tích source này.`);
  }
  function chooseIssue(issue: Issue) { setSelectedIssueId(issue.id); setSelectedFile(issue.filePath); setActiveNav("Phân tích AI"); }
  function navigate(item: string) { setActiveNav(item); window.setTimeout(() => document.getElementById(navTargets[item])?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="spark" size={20} /></span><span>sentinel</span><small>AI CODE REVIEW</small></div>
      <div className="workspace-switch"><span className="workspace-dot">S</span><div><b>Software Lab</b><small>Nhóm Đồ án CN</small></div><Icon name="chevron" size={15} /></div>
      <nav>{navItems.map((item, index) => <button key={item} className={activeNav === item ? "nav-item active" : "nav-item"} onClick={() => navigate(item)}><Icon name={["grid", "code", "spark", "flask", "clock"][index]} />{item}{item === "Phân tích AI" && <span className="nav-badge">{counts.pending}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="security-note"><span>●</span><div><b>Sandbox bảo mật</b><small>Docker isolation active</small></div></div><button className="profile"><span className="avatar">NT</span><div><b>Nguyễn Thành</b><small>Developer</small></div><Icon name="dots" size={18} /></button></div>
    </aside>

    <section className="content">
      <header className="topbar"><div className="breadcrumbs"><span>Dự án</span><Icon name="chevron" size={14} /><b>{project.name}</b><span className="version">{project.version}</span></div><div className="top-actions"><button className="icon-button" aria-label="Tìm kiếm"><Icon name="search" /></button><button className="outline-button" onClick={scanProject}><Icon name="spark" size={16} />{isScanning ? "Đang quét…" : "Quét lại"}</button><label className="primary-button"><Icon name="upload" size={16} />Tải source<input type="file" accept=".zip,.py" onChange={uploadProject} /></label></div></header>

      <div className="project-head" id="overview"><div><div className="eyebrow"><span className="live-dot" />MÔI TRƯỜNG PHÂN TÍCH SẴN SÀNG</div><h1>{project.name}</h1><p>Python 3.12 · Cập nhật {project.updatedAt} · <span>main</span></p></div><button className="branch-button"><Icon name="branch" size={16} />main <Icon name="chevron" size={14} /></button></div>

      <section className="review-layout" id="source">
        <article className="panel file-panel"><div className="panel-title"><div><b>Mã nguồn</b><small>{Object.keys(files).length} tệp</small></div><button className="icon-button"><Icon name="dots" /></button></div><div className="tree-root"><Icon name="folder" size={16} /><b>shopsafe-api</b></div>{Object.keys(files).map((path) => <button className={selectedFile === path ? "file-row selected" : "file-row"} key={path} onClick={() => setSelectedFile(path)}><span className="tree-indent" /> <span className="py-icon">PY</span>{path.split("/").at(-1)}{issues.some((i) => i.filePath === path && i.status === "PENDING") && <span className="issue-count">{issues.filter((i) => i.filePath === path && i.status === "PENDING").length}</span>}</button>)}</article>

        <article className="panel code-panel"><div className="panel-title"><div className="file-title"><span className="py-icon">PY</span><b>{selectedFile}</b></div><div className="code-actions"><span>UTF-8</span><button className="icon-button"><Icon name="dots" /></button></div></div><pre className="code-view">{files[selectedFile].split("\n").map((line, index) => <div className={selectedFile === selectedIssue?.filePath && index + 1 >= selectedIssue.lineStart && index + 1 <= selectedIssue.lineEnd ? "code-line flagged" : "code-line"} key={index}><span>{String(index + 1).padStart(2, " ")}</span><code>{highlightPython(line || " ")}</code></div>)}</pre><div className="code-footer"><span><i className="status-green" />Python</span><span>Ln {selectedIssue?.lineStart ?? "–"}, Col 5</span></div></article>

        <article className="panel issue-panel" id="analysis"><div className="panel-title"><div><b>Phát hiện AI</b><small>{counts.pending} cần xem xét</small></div><button className="filter-button" onClick={() => setFilter(filter === "ALL" ? "CRITICAL" : "ALL")}>{filter === "ALL" ? "Bộ lọc" : severityLabel[filter]}</button></div><div className="issue-list">{filteredIssues.map((issue) => <button className={selectedIssue?.id === issue.id ? "issue-card selected" : "issue-card"} key={issue.id} onClick={() => chooseIssue(issue)}><div className="issue-top"><span className={`severity ${issue.severity.toLowerCase()}`}>{severityLabel[issue.severity]}</span><span>{issue.id}</span></div><b>{issue.type}</b><p>{issue.description}</p><small>{issue.filePath.split("/").at(-1)} : {issue.lineStart} · <span className={`status ${issue.status.toLowerCase()}`}>{statusLabel[issue.status]}</span></small></button>)}</div></article>
      </section>

      <section className="details-grid"><article className="panel proposal-panel"><div className="panel-title"><div><span className={`severity ${selectedIssue.severity.toLowerCase()}`}>{severityLabel[selectedIssue.severity]}</span><h2>{selectedIssue.type}</h2></div><span className="confidence">Độ tin cậy {Math.round(selectedIssue.confidence * 100)}%</span></div><p className="issue-summary">{selectedIssue.explanation}</p><div className="location"><Icon name="code" size={16} /><b>{selectedIssue.filePath}</b><span>Dòng {selectedIssue.lineStart}–{selectedIssue.lineEnd}</span><span>{selectedIssue.ruleCode}</span></div>{selectedProposal ? <><div className="diff-head"><b>Đề xuất sửa từ AI</b><span>Patch đã được kiểm tra cú pháp</span></div><div className="diff"><div><label>− TRƯỚC</label><pre>{selectedProposal.originalCode}</pre></div><div><label>+ SAU</label><pre>{selectedProposal.replacementCode}</pre></div></div><p className="reason"><b>Lý do:</b> {selectedProposal.reason}</p><div className="review-actions">{selectedIssue.status === "PENDING" ? <><button className="reject-button" onClick={() => updateStatus(selectedIssue.id, "REJECTED")}><Icon name="x" size={16} />Từ chối</button><button className="accept-button" onClick={() => updateStatus(selectedIssue.id, "ACCEPTED")}><Icon name="check" size={16} />Chấp nhận đề xuất</button></> : <span className="decision">Đề xuất đang ở trạng thái: <b>{statusLabel[selectedIssue.status]}</b></span>}</div></> : <div className="empty-proposal">Đề xuất sửa không cần thiết vì vấn đề này đã được xác minh.</div>}</article>
        <aside className="side-stack"><article className="panel test-panel" id="testing"><div className="panel-title"><div><b>Kiểm thử & xác minh</b><small>Test Engine · Docker Sandbox</small></div><button className="run-button" onClick={() => setToast("Đã gửi yêu cầu test tới Test Engine. Trạng thái sẽ được TV4 trả về.")}><Icon name="play" size={14} />Chạy test</button></div>{testRuns.map((run) => <div className="test-run" key={run.id}><span className={run.status === "PASS" ? "run-icon pass-icon" : "run-icon fail-icon"}>{run.status === "PASS" ? "✓" : "!"}</span><div><b>{run.version} · {run.status === "PASS" ? "Đã xác minh" : "Baseline"}</b><small>{run.passed}/{run.total} passed · {run.duration}</small></div><span>{run.createdAt}</span></div>)}<div className="test-legend"><span><i className="status-green" />Không regression</span><span>Sandbox: isolated</span></div></article><article className="panel version-panel" id="versions"><div className="panel-title"><div><b>Lịch sử phiên bản</b><small>Rollback khả dụng</small></div><button className="icon-button"><Icon name="dots" /></button></div><div className="timeline"><div><span className="timeline-node current" /><b>v2 <small>Hiện tại</small></b><p>4 patch đã được áp dụng</p></div><div><span className="timeline-node" /><b>v1 <small>Source ban đầu</small></b><p>20/20 tests · 10:31</p></div></div><button className="rollback-button" onClick={() => setToast("Rollback sẽ gọi POST /projects/prj_001/rollback về phiên bản v1.")}>Khôi phục về v1</button></article></aside>
      </section>
    </section>
  </main>;
}
