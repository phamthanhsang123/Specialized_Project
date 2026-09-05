"use client";
import { useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { apiFetch, isAborted } from "../../lib/api";
import type { Activity, ActivityPage } from "../../lib/types";
import { dateLabel, Empty, initials } from "../components/ui";
import { useMessage } from "../components/use-message";
import { Drawer, Facts, Pagination } from "./admin-details";

const actionLabels: Record<string, string> = {
  USER_CREATED: "Tạo tài khoản Developer",
  USER_UPDATED: "Chỉnh sửa tài khoản",
  USER_LOCKED: "Khóa tài khoản Developer",
  USER_UNLOCKED: "Mở khóa tài khoản Developer",
  PASSWORD_RESET: "Đặt lại mật khẩu",
  PASSWORD_CHANGED: "Đổi mật khẩu",
  ACCEPTED: "Chấp nhận đề xuất sửa",
  REJECTED: "Từ chối đề xuất sửa",
  VERSION_SAVED: "Lưu phiên bản",
  TEST_RUN: "Chạy kiểm thử",
};
const detailLabels: Record<string, string> = {
  user_id: "Mã tài khoản",
  email: "Email",
  full_name: "Họ và tên",
  reason: "Lý do",
  previous_email: "Email trước đó",
  previous_full_name: "Họ tên trước đó",
  issue_id: "Mã vấn đề",
  issue_type: "Loại vấn đề",
  file_path: "Đường dẫn tệp",
  review_id: "Mã duyệt",
  version: "Phiên bản",
};
function label(action: string) {
  return t(actionLabels[action] || action);
}
export default function ActivityPanel({ refreshKey }: { refreshKey: string }) {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ActivityPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useMessage();
  const [selected, setSelected] = useState<Activity | null>(null);
  const invalid = Boolean(from && to && from > to);
  useEffect(() => {
    if (invalid) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), page_size: "10" });
    if (actor) params.set("actor_id", actor);
    if (action) params.set("action", action);
    if (from)
      params.set("date_from", new Date(`${from}T00:00:00`).toISOString());
    if (to) {
      const end = new Date(`${to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      params.set("date_to", end.toISOString());
    }
    apiFetch<ActivityPage>(`/admin/activities?${params}`, {
      signal: controller.signal,
    })
      .then(setResult)
      .catch((error) => {
        if (!isAborted(error)) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [actor, action, from, to, page, attempt, refreshKey, invalid]);
  return (
    <section className="admin-panel activity-panel" id="activities">
      <div className="admin-panel-head">
        <div>
          <b>{t("Nhật ký hoạt động")}</b>
          <small>
            {t(
              "Tra cứu toàn bộ lịch sử theo người thực hiện, hành động và thời gian.",
            )}
          </small>
        </div>
      </div>
      <div className="admin-filter-bar activity-filters">
        <label>
          {t("Người thực hiện")}
          <select
            aria-label={t("Người thực hiện")}
            value={actor}
            onChange={(event) => {
              setActor(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("Tất cả")}</option>
            <option value="system">{t("Hệ thống")}</option>
            {result?.actors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Hành động")}
          <select
            aria-label={t("Hành động")}
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("Tất cả")}</option>
            {result?.actions.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Từ ngày")}
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          {t("Đến ngày")}
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <button
          className="admin-outline"
          onClick={() => {
            setActor("");
            setAction("");
            setFrom("");
            setTo("");
            setPage(1);
          }}
        >
          {t("Xóa bộ lọc")}
        </button>
      </div>
      {invalid ? (
        <p className="admin-inline-error" role="alert">
          {t("Khoảng ngày không hợp lệ")}
        </p>
      ) : error ? (
        <div className="admin-inline-error" role="alert">
          {error}
          <button
            className="admin-outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("Thử lại")}
          </button>
        </div>
      ) : loading ? (
        <Empty>{t("Đang tải…")}</Empty>
      ) : (
        <>
          <div className="activity-list">
            {result?.items.map((item) => (
              <button
                className="activity admin-activity-button"
                key={item.id}
                onClick={() => setSelected(item)}
              >
                <span className="admin-avatar">
                  {initials(
                    item.actorName === "Hệ thống"
                      ? t("Hệ thống")
                      : item.actorName,
                  )}
                </span>
                <div>
                  <b>{label(item.action)}</b>
                  <p>
                    {item.actorName === "Hệ thống"
                      ? t("Hệ thống")
                      : item.actorName}{" "}
                    · {item.detail?.email || item.projectName || "—"}
                  </p>
                </div>
                <small>{dateLabel(item.createdAt)}</small>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
          {!result?.items.length && (
            <Empty>{t("Không có hoạt động phù hợp với bộ lọc.")}</Empty>
          )}
          <Pagination page={page} total={result?.total || 0} change={setPage} />
        </>
      )}
      {selected && (
        <Drawer title={t("Chi tiết hoạt động")} close={() => setSelected(null)}>
          <Facts
            items={[
              ["Mã hoạt động", selected.id],
              ["Hành động", label(selected.action)],
              [
                "Người thực hiện",
                selected.actorName === "Hệ thống"
                  ? t("Hệ thống")
                  : selected.actorName,
              ],
              ["Thời gian", dateLabel(selected.createdAt)],
              ["Dự án", selected.projectName || "—"],
              ...Object.entries(selected.detail || {})
                .filter(([, value]) => value)
                .map(([key, value]): [string, string] => [
                  detailLabels[key] || key,
                  String(value),
                ]),
            ]}
          />
          <p className="drawer-note">
            {t(
              "Nhật ký chỉ đọc. Mật khẩu và mã phiên đăng nhập không được hiển thị.",
            )}
          </p>
        </Drawer>
      )}
    </section>
  );
}
