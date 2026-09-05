"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { apiFetch, isAborted } from "../../lib/api";
import type {
  AdminProject,
  AdminProjectDetail,
  AdminUser,
} from "../../lib/types";
import { dateLabel, Empty, initials } from "../components/ui";
import { useDialog } from "../components/use-dialog";
import { useMessage } from "../components/use-message";

export function Drawer({
  title,
  close,
  busy = false,
  children,
}: {
  title: string;
  close: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  useDialog(true, busy, close);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <div className="admin-drawer-backdrop">
      <section
        className="admin-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <header className="drawer-heading">
          <div>
            <span className="admin-kicker">SENTINEL / ADMIN</span>
            <h2 id="drawer-title">{title}</h2>
          </div>
          <button
            className="admin-outline"
            aria-label={t("Đóng")}
            disabled={busy}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </section>
    </div>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="admin-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{t(label)}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({
  page,
  total,
  size = 10,
  change,
  busy = false,
}: {
  page: number;
  total: number;
  size?: number;
  change: (page: number) => void;
  busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="admin-pagination">
      <span>
        {t("{{total}} kết quả · Trang {{page}} / {{pages}}", {
          total,
          page,
          pages,
        })}
      </span>
      <div>
        <button
          className="admin-outline"
          disabled={busy || page <= 1}
          onClick={() => change(page - 1)}
        >
          {t("Trang trước")}
        </button>
        <button
          className="admin-outline"
          disabled={busy || page >= pages}
          onClick={() => change(page + 1)}
        >
          {t("Trang sau")}
        </button>
      </div>
    </div>
  );
}

export type UserAction = "detail" | "edit" | "reset" | "status";
export function UserDrawer({
  user,
  initialMode,
  busy,
  disabled,
  error,
  close,
  save,
}: {
  user: AdminUser;
  initialMode: UserAction;
  busy: boolean;
  disabled: boolean;
  error: string;
  close: () => void;
  save: (
    mode: Exclude<UserAction, "detail">,
    data: Record<string, string>,
  ) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [validation, setValidation] = useMessage();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<string, string>;
    if (mode === "reset" && data.temporaryPassword !== data.confirmation) {
      setValidation("Mật khẩu xác nhận không khớp");
      return;
    }
    setValidation("");
    if (mode !== "detail") save(mode, data);
  }
  const title =
    mode === "detail"
      ? "Chi tiết Developer"
      : mode === "edit"
        ? "Chỉnh sửa tài khoản"
        : mode === "reset"
          ? "Đặt lại mật khẩu"
          : user.isActive
            ? "Khóa tài khoản"
            : "Mở khóa tài khoản";
  return (
    <Drawer title={t(title)} close={close} busy={busy}>
      <div className="drawer-person">
        <span className="admin-avatar">{initials(user.fullName)}</span>
        <div>
          <b>{user.fullName}</b>
          <small>{user.email}</small>
        </div>
        <span className={user.isActive ? "user-active" : "user-locked"}>
          {user.isActive ? t("Hoạt động") : t("Đã khóa")}
        </span>
      </div>
      {mode === "detail" ? (
        <>
          <Facts
            items={[
              ["Mã tài khoản", user.id],
              ["Vai trò", "Developer"],
              ["Ngày tạo", dateLabel(user.createdAt)],
              ["Cập nhật", dateLabel(user.updatedAt)],
              ["Dự án", user.projectCount],
              ["VẤN ĐỀ", user.issueCount],
              [
                "Mật khẩu",
                user.mustChangePassword
                  ? t("Cần đổi mật khẩu")
                  : t("Đã thiết lập"),
              ],
            ]}
          />
          <p className="drawer-note">
            {t(
              "Admin chỉ quản lý tài khoản và thông tin dự án; Developer tự quyết định bản sửa mã nguồn.",
            )}
          </p>
          <div className="drawer-actions">
            <button
              className="admin-primary"
              disabled={disabled}
              onClick={() => setMode("edit")}
            >
              {t("Chỉnh sửa tài khoản")}
            </button>
            <button
              className="admin-outline"
              disabled={disabled}
              onClick={() => setMode("reset")}
            >
              {t("Đặt lại mật khẩu")}
            </button>
            <button
              className={user.isActive ? "lock-button" : "unlock-button"}
              disabled={disabled}
              onClick={() => setMode("status")}
            >
              {user.isActive ? t("Khóa tài khoản") : t("Mở khóa tài khoản")}
            </button>
          </div>
        </>
      ) : (
        <form className="drawer-form" key={mode} onSubmit={submit}>
          {mode === "edit" && (
            <>
              <label>
                {t("Họ và tên")}
                <input
                  name="fullName"
                  defaultValue={user.fullName}
                  required
                  maxLength={255}
                  disabled={busy}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  defaultValue={user.email}
                  required
                  maxLength={255}
                  disabled={busy}
                />
              </label>
              <p className="drawer-note">
                {t(
                  "Email mới sẽ được dùng cho lần đăng nhập tiếp theo. Quyền và dự án không thay đổi.",
                )}
              </p>
            </>
          )}
          {mode === "reset" && (
            <>
              <p className="drawer-warning">
                {t(
                  "Thao tác này thu hồi mọi phiên đăng nhập của Developer. Người dùng phải đổi mật khẩu tạm ở lần đăng nhập tiếp theo.",
                )}
              </p>
              <label>
                {t("Mật khẩu tạm")}
                <input
                  type="password"
                  name="temporaryPassword"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
              <label>
                {t("Xác nhận mật khẩu tạm")}
                <input
                  type="password"
                  name="confirmation"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
              <p className="drawer-note">
                {t(
                  "Ít nhất 8 ký tự. Chuyển mật khẩu tạm cho đúng người dùng qua kênh riêng; hệ thống không lưu mật khẩu trong nhật ký.",
                )}
              </p>
              {!user.isActive && (
                <p className="drawer-warning">
                  {t(
                    "Tài khoản vẫn bị khóa sau khi đặt lại mật khẩu. Chỉ mở khóa khi được phép.",
                  )}
                </p>
              )}
            </>
          )}
          {mode === "status" && (
            <>
              <p className="drawer-warning">
                {user.isActive
                  ? t(
                      "Bạn sắp khóa {{email}}. Mọi phiên đăng nhập sẽ bị thu hồi; dự án và dữ liệu vẫn được giữ nguyên.",
                      { email: user.email },
                    )
                  : t(
                      "Bạn sắp mở khóa {{email}} để người dùng có thể đăng nhập trở lại.",
                      { email: user.email },
                    )}
              </p>
              <label>
                {t("Lý do (không bắt buộc)")}
                <textarea
                  name="reason"
                  maxLength={500}
                  rows={3}
                  disabled={busy}
                />
              </label>
            </>
          )}
          {(validation || error) && (
            <p role="alert" className="error-text">
              {validation || error}
            </p>
          )}
          <div className="drawer-actions">
            <button type="submit" className="admin-primary" disabled={disabled}>
              {busy
                ? t("Đang lưu…")
                : mode === "edit"
                  ? t("Lưu thay đổi")
                  : mode === "reset"
                    ? t("Xác nhận đặt lại mật khẩu")
                    : user.isActive
                      ? t("Xác nhận khóa")
                      : t("Xác nhận mở khóa")}
            </button>
            <button
              type="button"
              className="admin-outline"
              disabled={busy}
              onClick={close}
            >
              {t("Hủy")}
            </button>
          </div>
        </form>
      )}
    </Drawer>
  );
}

function ProjectDrawer({
  project,
  close,
}: {
  project: AdminProject;
  close: () => void;
}) {
  const [detail, setDetail] = useState<AdminProjectDetail | null>(null);
  const [error, setError] = useMessage();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError("");
    apiFetch<AdminProjectDetail>(
      `/admin/projects/${encodeURIComponent(project.id)}`,
      { signal: controller.signal },
    )
      .then(setDetail)
      .catch((error) => {
        if (!isAborted(error)) setError(error.message);
      });
    return () => controller.abort();
  }, [project.id, attempt]);
  return (
    <Drawer title={t("Chi tiết dự án")} close={close}>
      <h3>{project.name}</h3>
      <p className="drawer-note">
        {t(
          "Chỉ xem thông tin quản trị. Không truy cập hoặc chỉnh sửa mã nguồn tại đây.",
        )}
      </p>
      {error ? (
        <>
          <p role="alert" className="error-text">
            {error}
          </p>
          <button
            className="admin-outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("Thử lại")}
          </button>
        </>
      ) : !detail ? (
        <Empty>{t("Đang tải…")}</Empty>
      ) : (
        <>
          <Facts
            items={[
              ["Mã dự án", detail.id],
              ["Chủ sở hữu", detail.ownerName || t("Chưa gán chủ sở hữu")],
              ["Ngôn ngữ lập trình", detail.language],
              ["Phiên bản", detail.version],
              ["Ngày tạo", dateLabel(detail.createdAt)],
              ["Cập nhật", dateLabel(detail.updatedAt)],
              ["VẤN ĐỀ", detail.issueCount],
            ]}
          />
          <h3>{t("Kiểm thử gần nhất")}</h3>
          {detail.latestTest ? (
            <Facts
              items={[
                ["Phiên bản kiểm thử", detail.latestTest.version],
                ["Kết quả", detail.latestTest.status],
                [
                  "Đã đạt / Tổng",
                  `${detail.latestTest.passed} / ${detail.latestTest.total}`,
                ],
                [
                  "Không đạt / Lỗi",
                  `${detail.latestTest.failed} / ${detail.latestTest.errors}`,
                ],
                ["Thời gian", dateLabel(detail.latestTest.createdAt)],
              ]}
            />
          ) : (
            <Empty>{t("Dự án chưa có kết quả kiểm thử.")}</Empty>
          )}
        </>
      )}
    </Drawer>
  );
}

export function ProjectsPanel({
  projects,
  users,
}: {
  projects: AdminProject[];
  users: AdminUser[];
}) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminProject | null>(null);
  const filtered = projects.filter(
    (project) =>
      (!owner ||
        (owner === "unassigned"
          ? !project.ownerId
          : project.ownerId === owner)) &&
      `${project.name} ${project.ownerName}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / 10)),
  );
  return (
    <article className="admin-panel" id="projects">
      <div className="admin-panel-head">
        <div>
          <b>{t("Project toàn hệ thống")}</b>
          <small>{t("Chỉ xem thông tin quản trị")}</small>
        </div>
      </div>
      <div className="admin-filter-bar">
        <label>
          {t("Tìm dự án")}
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={t("Tên dự án hoặc chủ sở hữu…")}
          />
        </label>
        <label>
          {t("Chủ sở hữu")}
          <select
            aria-label={t("Chủ sở hữu")}
            value={owner}
            onChange={(event) => {
              setOwner(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("Tất cả Developer")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName} · {user.email}
              </option>
            ))}
            <option value="unassigned">{t("Chưa gán chủ sở hữu")}</option>
          </select>
        </label>
      </div>
      <div className="admin-project-list">
        {filtered
          .slice((currentPage - 1) * 10, currentPage * 10)
          .map((project) => (
            <button
              className="project-item admin-project-button"
              key={project.id}
              onClick={() => setSelected(project)}
            >
              <span>PY</span>
              <div>
                <b>{project.name}</b>
                <small>
                  {project.ownerName || t("Chưa gán chủ sở hữu")} ·{" "}
                  {project.version}
                </small>
                <small>{dateLabel(project.updatedAt)}</small>
              </div>
              <em>{t("{{count}} vấn đề", { count: project.issueCount })}</em>
              <span className="row-chevron" aria-hidden="true">
                →
              </span>
            </button>
          ))}
      </div>
      {!filtered.length && <Empty>{t("Không tìm thấy dự án phù hợp.")}</Empty>}
      <Pagination page={currentPage} total={filtered.length} change={setPage} />
      {selected && (
        <ProjectDrawer project={selected} close={() => setSelected(null)} />
      )}
    </article>
  );
}
