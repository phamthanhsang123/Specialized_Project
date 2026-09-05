"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, errorMessage, isAborted } from "../../lib/api";
import { useSession } from "../../lib/auth";
import type { AdminOverview, AdminUser } from "../../lib/types";
import { dateLabel, Empty, Icon, initials, SessionGate } from "../components/ui";
const navigation = [{
  id: "admin-overview",
  label: "Tổng quan",
  icon: "grid"
}, {
  id: "users",
  label: "Người dùng",
  icon: "code"
}, {
  id: "projects",
  label: "Project",
  icon: "folder"
}, {
  id: "statistics",
  label: "Thống kê",
  icon: "spark"
}, {
  id: "activities",
  label: "Hoạt động",
  icon: "clock"
}];
const percentage = (value: number | null | undefined) => value == null ? "Chưa có dữ liệu" : `${Math.round(value * 100)}%`;
export default function AdminPage() {
  const {
    user,
    sessionError,
    logout,
    retrySession
  } = useSession("admin");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activeNav, setActiveNav] = useState("admin-overview");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "LOCKED">("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const actionInProgress = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refreshId = useRef(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const serial = ++refreshId.current;
    setLoading(true);
    try {
      const result = await apiFetch<AdminOverview>("/admin/overview", {
        signal
      });
      if (signal?.aborted || serial !== refreshId.current) return;
      setOverview(result);
      setUpdatedAt(new Date().toLocaleTimeString("vi-VN"));
    } catch (failure) {
      if (!isAborted(failure) && serial === refreshId.current) setError(errorMessage(failure));
    } finally {
      if (!signal?.aborted && serial === refreshId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [user, loadOverview]);
  const visibleUsers = useMemo(() => (overview?.users ?? []).filter(item => {
    const matchesQuery = `${item.fullName} ${item.email}`.toLowerCase().includes(query.toLowerCase().trim());
    return matchesQuery && (statusFilter === "ALL" || item.isActive === (statusFilter === "ACTIVE"));
  }), [overview, query, statusFilter]);
  function navigate(id: string) {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  async function toggleUser(target: AdminUser) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(target.id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          isActive: !target.isActive
        })
      });
      setNotice(`Đã ${target.isActive ? "khóa" : "mở khóa"} tài khoản ${target.email}.`);
      await loadOverview();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionInProgress.current) return;
    const values = new FormData(event.currentTarget);
    const payload = {
      fullName: String(values.get("fullName")).trim(),
      email: String(values.get("email")).trim(),
      password: String(values.get("password"))
    };
    actionInProgress.current = true;
    setBusy("create");
    setError("");
    setNotice("");
    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setShowCreate(false);
      setNotice(`Đã tạo tài khoản ${payload.email}.`);
      await loadOverview();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  if (!user) return <SessionGate error={sessionError} retry={retrySession} logout={logout} />;
  const metrics = overview?.metrics;
  const disabled = loading || Boolean(busy);
  return <main className="admin-shell connected-admin">
    <aside className="admin-sidebar">
      <div className="brand">
        <span className="brand-mark"><Icon name="spark" size={20} /></span>
        <span>sentinel</span>
        <small>ADMIN CONSOLE</small>
      </div>
      <div className="admin-workspace">
        <span className="admin-avatar admin-avatar-gold">S</span>
        <div>
          <b>Quản trị hệ thống</b>
          <small>Admin workspace</small>
        </div>
      </div>
      <nav aria-label="Điều hướng Admin">
        {navigation.map(item => <button key={item.id} title={item.label} aria-label={item.label} className={`nav-item${activeNav === item.id ? " active" : ""}`} onClick={() => navigate(item.id)}>
          <Icon name={item.icon} />
          <span className="nav-label">{item.label}</span>
        </button>)}
      </nav>
      <div className="admin-side-bottom"><div className="admin-profile-menu">
          <div className="admin-profile">
            <span className="admin-avatar">{initials(user.fullName)}</span>
            <div>
              <b>{user.fullName}</b>
              <small>Quản trị viên</small>
            </div>
          </div>
          <button className="logout-button" onClick={() => void logout()}>↪ Đăng xuất</button>
        </div></div>
    </aside>

    <section className="admin-content">
      <header className="admin-topbar">
        <div>
          <span className="admin-kicker">ADMINISTRATION</span>
          <h1>Trung tâm quản trị</h1>
        </div>
        <div className="admin-top-actions">
          <span className="admin-live">{updatedAt ? `Cập nhật ${updatedAt}` : "Đang tải dữ liệu…"}</span>
          <button className="admin-outline" disabled={disabled} onClick={() => {
            setError("");
            setNotice("");
            void loadOverview();
          }}>↻ {loading ? "Đang tải…" : "Đồng bộ"}</button>
          <button className="admin-primary" disabled={disabled} onClick={() => {
            setError("");
            setShowCreate(true);
          }}>＋ Thêm Developer</button>
        </div>
      </header>
      {error && <div className="admin-notice toast-error" role="alert">
        {error}
        <button onClick={() => {
          setError("");
          void loadOverview();
        }}>Thử lại</button>
      </div>}
      {notice && <div className="admin-notice" role="status">{notice}</div>}
      {loading && !overview && <Empty>Đang tải dữ liệu quản trị…</Empty>}
      {overview && <>
        <section className="admin-stats" id="admin-overview" aria-label="Thống kê hệ thống">
          <article>
            <span className="stat-symbol users">♙</span>
            <div>
              <small>TÀI KHOẢN DEVELOPER</small>
              <b>{metrics?.users}</b>
              <p>{metrics?.activeUsers} tài khoản hoạt động</p>
            </div>
          </article>
          <article>
            <span className="stat-symbol projects">▱</span>
            <div>
              <small>PROJECT</small>
              <b>{metrics?.projects}</b>
              <p>Toàn hệ thống</p>
            </div>
          </article>
          <article>
            <span className="stat-symbol scan">⌕</span>
            <div>
              <small>VẤN ĐỀ</small>
              <b>{metrics?.issues}</b>
              <p>Kết quả quét đang lưu</p>
            </div>
          </article>
          <article>
            <span className="stat-symbol success">✓</span>
            <div>
              <small>LƯỢT KIỂM THỬ</small>
              <b>{metrics?.testRuns}</b>
              <p>{metrics?.verifiedIssues} vấn đề đã xác minh</p>
            </div>
          </article>
        </section>
        <section className="admin-grid">
          <article className="admin-panel users-panel" id="users">
            <div className="admin-panel-head"><div>
                <b>Quản lý Developer</b>
                <small>{overview.users.length} tài khoản trong hệ thống</small>
              </div></div>
            <div className="user-controls">
              <label className="admin-search">
                <span aria-hidden="true">⌕</span>
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên hoặc email…" aria-label="Tìm Developer" />
              </label>
              <div className="status-tabs">{(["ALL", "ACTIVE", "LOCKED"] as const).map(status => <button key={status} className={statusFilter === status ? "selected" : ""} onClick={() => setStatusFilter(status)}>{status === "ALL" ? "Tất cả" : status === "ACTIVE" ? "Hoạt động" : "Đã khóa"}</button>)}</div>
            </div>
            <div className="user-table"><div className="user-row table-header">
                <span>DEVELOPER</span>
                <span>PROJECT</span>
                <span>VẤN ĐỀ</span>
                <span>TRẠNG THÁI</span>
                <span />
              </div>
              {visibleUsers.map(item => <div className="user-row" key={item.id}>
                <div className="user-person">
                  <span className="admin-avatar">{initials(item.fullName)}</span>
                  <div>
                    <b>{item.fullName}</b>
                    <small>{item.email}</small>
                  </div>
                </div>
                <span>{item.projectCount}</span>
                <span>{item.issueCount}</span>
                <div>
                  <b className={item.isActive ? "user-active" : "user-locked"}>● {item.isActive ? "Hoạt động" : "Đã khóa"}</b>
                  <small>Cập nhật {dateLabel(item.updatedAt)}</small>
                </div>
                <button className={item.isActive ? "lock-button" : "unlock-button"} disabled={disabled} onClick={() => void toggleUser(item)}>{busy === item.id ? "…" : item.isActive ? "Khóa" : "Mở khóa"}</button>
              </div>)}
              {!visibleUsers.length && <Empty>{overview.users.length ? "Không tìm thấy tài khoản phù hợp." : "Chưa có Developer. Tạo tài khoản để bắt đầu."}</Empty>}
            </div>
          </article>
          <aside className="admin-right">
            <article className="admin-panel" id="projects">
              <div className="admin-panel-head"><div>
                  <b>Project toàn hệ thống</b>
                  <small>{overview.projects.length} project</small>
                </div></div>
              <div className="admin-project-list">{overview.projects.map(project => <div className="project-item" key={project.id}>
                  <span>PY</span>
                  <div>
                    <b>{project.name}</b>
                    <small>{project.ownerName} · {project.version}</small>
                    <small>{dateLabel(project.updatedAt)}</small>
                  </div>
                  <em>{project.issueCount} vấn đề</em>
                </div>)}</div>
              {!overview.projects.length && <Empty>Chưa có project.</Empty>}
            </article>
            <article className="admin-panel" id="statistics">
              <div className="admin-panel-head"><div>
                  <b>Đánh giá AI</b>
                  <small>Chỉ hiển thị khi đã có phép đo</small>
                </div></div>
              <dl className="metric-list">
                <div>
                  <dt>Precision</dt>
                  <dd>{percentage(metrics?.precision)}</dd>
                </div>
                <div>
                  <dt>Recall</dt>
                  <dd>{percentage(metrics?.recall)}</dd>
                </div>
                <div>
                  <dt>Tỷ lệ sửa thành công</dt>
                  <dd>{percentage(metrics?.fixSuccessRate)}</dd>
                </div>
              </dl>
              <p className="form-help panel-help">Các chỉ số cần được đo trên bộ dữ liệu có nhãn và kết quả kiểm thử của nhóm.</p>
            </article>
          </aside>
        </section>
        <section className="admin-panel activity-panel" id="activities">
          <div className="admin-panel-head"><div>
              <b>Hoạt động gần đây</b>
              <small>Lịch sử đang được lưu trong hệ thống</small>
            </div></div>
          <div className="activity-list">{overview.activities.map(activity => <div className="activity" key={activity.id}>
              <span className="admin-avatar">{initials(activity.actorName || "Hệ thống")}</span>
              <p><b>{activity.actorName || "Hệ thống"}</b> · {activity.action}{activity.projectName && <> · <strong>{activity.projectName}</strong></>}</p>
              <small>{dateLabel(activity.createdAt)}</small>
            </div>)}</div>
          {!overview.activities.length && <Empty>Chưa có hoạt động được ghi nhận.</Empty>}
        </section>
      </>}
    </section>
    {showCreate && <div className="admin-modal-backdrop"><form className="admin-modal" onSubmit={addUser} role="dialog" aria-modal="true" aria-labelledby="create-user-title">
        <button type="button" className="modal-close" aria-label="Đóng" disabled={Boolean(busy)} onClick={() => setShowCreate(false)}>×</button>
        <span className="modal-symbol">♙</span>
        <h2 id="create-user-title">Thêm Developer</h2>
        <p>Tạo tài khoản đăng nhập thật, dữ liệu được lưu trong hệ thống.</p>
        <label>Họ và tên<input name="fullName" required maxLength={255} autoFocus placeholder="Nguyễn Văn A" disabled={Boolean(busy)} /></label>
        <label>Email<input name="email" required type="email" maxLength={255} autoComplete="off" placeholder="developer@email.com" disabled={Boolean(busy)} /></label>
        <label>Mật khẩu ban đầu<input name="password" required type="password" minLength={8} maxLength={128} autoComplete="new-password" placeholder="Ít nhất 8 ký tự" disabled={Boolean(busy)} /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="admin-primary" disabled={Boolean(busy)} type="submit">{busy ? "Đang tạo…" : "Tạo tài khoản Developer"}</button>
      </form></div>}
  </main>;
}
