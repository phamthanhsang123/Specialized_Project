"use client";
import { t } from "../../lib/i18n";
import { useTranslation } from "react-i18next";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, apiFetch, errorMessage, isAborted } from "../../lib/api";
import { useSession } from "../../lib/auth";
import type { AdminOverview, AdminUser } from "../../lib/types";
import { LanguageSwitcher } from "../components/language-switcher";
import { useMessage } from "../components/use-message";
import { useDialog } from "../components/use-dialog";
import { useStepFocus } from "../components/use-step-focus";
import RecoveryBanner from "../components/recovery-banner";
import {
  Pagination,
  ProjectsPanel,
  UserDrawer,
  type UserAction,
} from "./admin-details";
import ActivityPanel from "./activity-panel";
import {
  dateLabel,
  Empty,
  Icon,
  initials,
  SessionGate,
} from "../components/ui";
const navigation = [
  { id: "users", label: "Người dùng", icon: "grid" },
  { id: "projects", label: "Dự án", icon: "folder" },
  { id: "activities", label: "Nhật ký hoạt động", icon: "clock" },
];

export default function AdminPage() {
  useTranslation();
  const { user, sessionError, logout, retrySession } = useSession("admin");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activeNav, setActiveNav] = useState("users");
  const viewport = useStepFocus(activeNav);
  const [stale, setStale] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [recovery, setRecovery] = useMessage();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "LOCKED">(
    "ALL",
  );
  const [showCreate, setShowCreate] = useState(false);
  const [userDialog, setUserDialog] = useState<{
    user: AdminUser;
    mode: UserAction;
  } | null>(null);
  const [userPage, setUserPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const actionInProgress = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useMessage();
  const refreshId = useRef(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const serial = ++refreshId.current;
    setLoading(true);
    try {
      const result = await apiFetch<AdminOverview>("/admin/overview", {
        signal,
      });
      if (signal?.aborted || serial !== refreshId.current) return false;
      setOverview(result);
      setUpdatedAt(new Date().toISOString());
      setStale(false);
      setRecovery("");
      setError("");
      return true;
    } catch (failure) {
      if (!isAborted(failure) && serial === refreshId.current) {
        setStale(true);
        setError(errorMessage(failure));
      }
      return false;
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
  const visibleUsers = useMemo(
    () =>
      (overview?.users ?? []).filter((item) => {
        const matchesQuery = `${item.fullName} ${item.email}`
          .toLowerCase()
          .includes(query.toLowerCase().trim());
        return (
          matchesQuery &&
          (statusFilter === "ALL" ||
            item.isActive === (statusFilter === "ACTIVE"))
        );
      }),
    [overview, query, statusFilter],
  );
  function navigate(id: string) {
    setActiveNav(id);
    setNotice("");
  }
  const currentUserPage = Math.min(
    userPage,
    Math.max(1, Math.ceil(visibleUsers.length / 10)),
  );
  function openUser(target: AdminUser, mode: UserAction) {
    setError("");
    setNotice("");
    setUserDialog({ user: target, mode });
  }
  async function changeUser(
    target: AdminUser,
    mode: Exclude<UserAction, "detail">,
    values: Record<string, string>,
  ) {
    if (actionInProgress.current || stale || uncertain || loading) return;
    actionInProgress.current = true;
    setBusy(target.id);
    setError("");
    setNotice("");
    try {
      const suffix =
        mode === "edit"
          ? "/profile"
          : mode === "reset"
            ? "/reset-password"
            : "";
      await apiFetch(`/admin/users/${encodeURIComponent(target.id)}${suffix}`, {
        method: mode === "edit" ? "PUT" : mode === "reset" ? "POST" : "PATCH",
        body: JSON.stringify(
          mode === "edit"
            ? { fullName: values.fullName.trim(), email: values.email.trim() }
            : mode === "reset"
              ? { temporaryPassword: values.temporaryPassword }
              : { isActive: !target.isActive, reason: values.reason || "" },
        ),
      });
      setUserDialog(null);
      const fresh = await loadOverview();
      if (fresh)
        setNotice(
          mode === "edit"
            ? "Đã cập nhật tài khoản {{email}}."
            : mode === "reset"
              ? "Đã đặt lại mật khẩu cho {{email}}. Người dùng phải đổi mật khẩu ở lần đăng nhập tiếp theo."
              : target.isActive
                ? "Đã khóa tài khoản {{email}}."
                : "Đã mở khóa tài khoản {{email}}.",
          { email: mode === "edit" ? values.email.trim() : target.email },
        );
      else
        setRecovery(
          "Thao tác đã được lưu, nhưng chưa tải được dữ liệu mới. Hãy tải lại dữ liệu; không gửi lại thao tác.",
        );
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiError && failure.uncertain) {
        setUserDialog(null);
        setStale(true);
        setUncertain(true);
        setRecovery(
          "Chưa xác định kết quả thao tác. Dừng chờ không hủy xử lý trên máy chủ. Hãy kiểm tra dữ liệu và tránh gửi lặp.",
        );
      }
    } finally {
      actionInProgress.current = false;
      setBusy("");
    }
  }
  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionInProgress.current || stale || uncertain || loading) return;
    const values = new FormData(event.currentTarget);
    const payload = {
      fullName: String(values.get("fullName")).trim(),
      email: String(values.get("email")).trim(),
      password: String(values.get("password")),
    };
    actionInProgress.current = true;
    setBusy("create");
    setError("");
    setNotice("");
    try {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setShowCreate(false);
      const fresh = await loadOverview();
      if (fresh) setNotice("Đã tạo tài khoản {{v0}}.", { v0: payload.email });
      else
        setRecovery(
          "Thao tác đã được lưu, nhưng chưa tải được dữ liệu mới. Hãy tải lại dữ liệu; không gửi lại thao tác.",
        );
    } catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiError && failure.uncertain) {
        setStale(true);
        setUncertain(true);
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
  useDialog(showCreate, Boolean(busy), () => {
    setShowCreate(false);
    setError("");
  });
  if (!user)
    return (
      <SessionGate error={sessionError} retry={retrySession} logout={logout} />
    );

  const disabled = loading || Boolean(busy) || stale || uncertain;
  return (
    <main className="admin-shell connected-admin workspace-v2">
      <aside className="admin-sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="spark" size={20} />
          </span>
          <span>sentinel</span>
          <small>ADMIN CONSOLE</small>
        </div>
        <div className="admin-workspace">
          <span className="admin-avatar admin-avatar-gold">S</span>
          <div>
            <b>{t("Quản trị hệ thống")}</b>
            <small>Admin workspace</small>
          </div>
        </div>
        <nav aria-label={t("Điều hướng Admin")}>
          {navigation.map((item) => (
            <button
              key={item.id}
              title={t(item.label)}
              aria-label={t(item.label)}
              className={`nav-item${activeNav === item.id ? " active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} />
              <span className="nav-label">{t(item.label)}</span>
            </button>
          ))}
        </nav>
        <div className="admin-side-bottom">
          <div className="admin-profile-menu">
            <div className="admin-profile">
              <span className="admin-avatar">{initials(user.fullName)}</span>
              <div>
                <b>{user.fullName}</b>
                <small>{t("Quản trị viên")}</small>
              </div>
            </div>
            <button className="logout-button" onClick={() => void logout()}>
              {t("↪ Đăng xuất")}
            </button>
          </div>
        </div>
      </aside>

      <section className="admin-content" ref={viewport}>
        <header className="admin-topbar">
          <div>
            <span className="admin-kicker">ADMINISTRATION</span>
            <h1>
              {t(navigation.find((item) => item.id === activeNav)?.label ?? "")}
            </h1>
          </div>
          <div className="admin-top-actions">
            <LanguageSwitcher />
            <span className="admin-live">
              {updatedAt
                ? t("Cập nhật {{v0}}", { v0: dateLabel(updatedAt) })
                : t("Đang tải dữ liệu…")}
            </span>
            <button
              className="admin-outline"
              disabled={loading || Boolean(busy)}
              onClick={() => {
                setError("");
                setNotice("");
                void loadOverview();
              }}
            >
              ↻ {loading ? t("Đang tải…") : t("Đồng bộ")}
            </button>
            {activeNav === "users" && (
              <button
                className="admin-primary"
                disabled={disabled}
                onClick={() => {
                  setError("");
                  setShowCreate(true);
                }}
              >
                {t("＋ Thêm Developer")}
              </button>
            )}
          </div>
        </header>
        <RecoveryBanner
          message={recovery}
          stale={stale}
          uncertain={uncertain}
          loading={loading || Boolean(busy)}
          refresh={() => {
            void loadOverview().then((fresh) => {
              if (fresh && !uncertain) setRecovery("");
            });
          }}
          acknowledge={() => {
            setUncertain(false);
            setRecovery("");
            setError("");
          }}
        />
        {error && (
          <div className="admin-notice toast-error" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                void loadOverview();
              }}
            >
              {t("Thử lại")}
            </button>
          </div>
        )}
        {notice && (
          <div className="admin-notice" role="status">
            {notice}
          </div>
        )}
        {loading && !overview && (
          <Empty>{t("Đang tải dữ liệu quản trị…")}</Empty>
        )}
        {overview && (
          <>
            <section className="admin-grid">
              <article
                className="admin-panel users-panel"
                id="users"
                hidden={activeNav !== "users"}
              >
                <div className="admin-panel-head">
                  <div>
                    <b>{t("Quản lý Developer")}</b>
                    <small>
                      {t("{{count}} tài khoản trong hệ thống", {
                        count: overview.users.length,
                      })}
                    </small>
                  </div>
                </div>
                <div className="user-controls">
                  <label className="admin-search">
                    <span aria-hidden="true">⌕</span>
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setUserPage(1);
                      }}
                      placeholder={t("Tìm tên hoặc email…")}
                      aria-label={t("Tìm Developer")}
                    />
                  </label>
                  <div className="status-tabs">
                    {(["ALL", "ACTIVE", "LOCKED"] as const).map((status) => (
                      <button
                        key={status}
                        className={statusFilter === status ? "selected" : ""}
                        onClick={() => {
                          setStatusFilter(status);
                          setUserPage(1);
                        }}
                      >
                        {status === "ALL"
                          ? t("Tất cả")
                          : status === "ACTIVE"
                            ? t("Hoạt động")
                            : t("Đã khóa")}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="user-table">
                  <div className="user-row table-header">
                    <span>DEVELOPER</span>
                    <span>{t("Dự án")}</span>
                    <span>{t("VẤN ĐỀ")}</span>
                    <span>{t("TRẠNG THÁI")}</span>
                    <span />
                  </div>
                  {visibleUsers
                    .slice((currentUserPage - 1) * 10, currentUserPage * 10)
                    .map((item) => (
                      <div className="user-row" key={item.id}>
                        <div className="user-person">
                          <span className="admin-avatar">
                            {initials(item.fullName)}
                          </span>
                          <div>
                            <button
                              className="admin-name-link"
                              onClick={() => openUser(item, "detail")}
                              aria-label={t("Xem tài khoản {{name}}", {
                                name: item.fullName,
                              })}
                            >
                              {item.fullName}
                            </button>
                            <small>{item.email}</small>
                            {item.mustChangePassword && (
                              <small className="password-required">
                                {t("Cần đổi mật khẩu")}
                              </small>
                            )}
                          </div>
                        </div>
                        <span data-label={t("Dự án")}>{item.projectCount}</span>
                        <span data-label={t("vấn đề")}>{item.issueCount}</span>
                        <div>
                          <b
                            className={
                              item.isActive ? "user-active" : "user-locked"
                            }
                          >
                            ● {item.isActive ? t("Hoạt động") : t("Đã khóa")}
                          </b>
                          <small>
                            {t("Cập nhật")} {dateLabel(item.updatedAt)}
                          </small>
                        </div>
                        <button
                          className={
                            item.isActive ? "lock-button" : "unlock-button"
                          }
                          disabled={disabled}
                          onClick={() => openUser(item, "status")}
                        >
                          {busy === item.id
                            ? "…"
                            : item.isActive
                              ? t("Khóa")
                              : t("Mở khóa")}
                        </button>
                      </div>
                    ))}
                  {!visibleUsers.length && (
                    <Empty>
                      {overview.users.length
                        ? t("Không tìm thấy tài khoản phù hợp.")
                        : t("Chưa có Developer. Tạo tài khoản để bắt đầu.")}
                    </Empty>
                  )}
                </div>
                <Pagination
                  page={currentUserPage}
                  total={visibleUsers.length}
                  change={setUserPage}
                  busy={loading}
                />
              </article>
              {activeNav === "projects" && (
                <ProjectsPanel
                  projects={overview.projects}
                  users={overview.users}
                />
              )}
            </section>
            {activeNav === "activities" && (
              <ActivityPanel refreshKey={updatedAt} />
            )}
          </>
        )}
      </section>
      {userDialog && (
        <UserDrawer
          key={`${userDialog.user.id}-${userDialog.mode}`}
          user={
            overview?.users.find((item) => item.id === userDialog.user.id) ||
            userDialog.user
          }
          initialMode={userDialog.mode}
          busy={Boolean(busy)}
          disabled={disabled}
          error={error}
          close={() => {
            setUserDialog(null);
            setError("");
          }}
          save={(mode, values) =>
            void changeUser(userDialog.user, mode, values)
          }
        />
      )}
      {showCreate && (
        <div className="admin-modal-backdrop">
          <form
            className="admin-modal"
            onSubmit={addUser}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-title"
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
            <span className="modal-symbol">♙</span>
            <h2 id="create-user-title">{t("Thêm Developer")}</h2>
            <p>
              {t(
                "Tạo tài khoản đăng nhập thật, dữ liệu được lưu trong hệ thống.",
              )}
            </p>
            <label>
              {t("Họ và tên")}
              <input
                name="fullName"
                required
                maxLength={255}
                autoFocus
                placeholder={t("Nguyễn Văn A")}
                disabled={Boolean(busy)}
              />
            </label>
            <label>
              Email
              <input
                name="email"
                required
                type="email"
                maxLength={255}
                autoComplete="off"
                placeholder="developer@email.com"
                disabled={Boolean(busy)}
              />
            </label>
            <label>
              {t("Mật khẩu ban đầu")}
              <input
                name="password"
                required
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                placeholder={t("Ít nhất 8 ký tự")}
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
              {busy ? t("Đang tạo…") : t("Tạo tài khoản Developer")}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
