"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  apiFetch,
  clearToken,
  getToken,
  isAborted,
  ApiError,
} from "../../lib/api";
import { landingPath } from "../../lib/auth";
import type { User } from "../../lib/types";
import { t } from "../../lib/i18n";
import { LanguageSwitcher } from "../components/language-switcher";
import { useMessage } from "../components/use-message";

export default function ChangePasswordPage() {
  useTranslation();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useMessage();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inProgress = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!getToken()) router.replace("/login");
    else
      apiFetch<User>("/auth/me", { signal: controller.signal })
        .then((current) => {
          if (!current.mustChangePassword) router.replace(landingPath(current));
          else setUser(current);
        })
        .catch((error) => {
          if (isAborted(error)) return;
          if (error instanceof ApiError && error.status === 401)
            router.replace("/login");
          else setMessage(error.message);
        });
    return () => controller.abort();
  }, [router, attempt]);

  function leave() {
    const request = getToken()
      ? apiFetch("/auth/logout", {
          method: "POST",
          timeoutMs: 5000,
          sessionBound: false,
        })
      : null;
    clearToken();
    void request?.catch(() => {});
    router.replace(user?.role === "admin" ? "/admin/login" : "/login");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inProgress.current || done || uncertain) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get("newPassword") !== data.get("confirmation")) {
      setMessage("Mật khẩu xác nhận không khớp");
      return;
    }
    inProgress.current = true;
    setBusy(true);
    setMessage("");
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: data.get("currentPassword"),
          newPassword: data.get("newPassword"),
        }),
      });
      clearToken();
      form.reset();
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.uncertain) {
        setUncertain(true);
        form.reset();
        clearToken();
        setMessage(
          "Chưa xác định kết quả đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới; nếu không được, thử mật khẩu tạm hoặc liên hệ Admin.",
        );
      } else if (error instanceof ApiError && error.status === 401) {
        setUncertain(true);
        form.reset();
        setMessage(
          "Phiên đăng nhập đã hết hạn hoặc tài khoản đã bị khóa. Vui lòng đăng nhập lại.",
        );
      } else
        setMessage(
          error instanceof Error ? error.message : "Không thể đổi mật khẩu",
        );
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="password-page">
      <div className="password-card">
        <header>
          <b className="password-brand">✦ sentinel</b>
          <LanguageSwitcher />
        </header>
        <p className="form-eyebrow">{t("BẢO MẬT TÀI KHOẢN")}</p>
        <h1>{done ? t("Đã đổi mật khẩu") : t("Đổi mật khẩu tạm")}</h1>
        <p className="form-subtitle">
          {done
            ? t(
                "Đã thu hồi các phiên cũ. Đăng nhập lại bằng mật khẩu mới để tiếp tục.",
              )
            : t(
                "Tài khoản được cấp lại mật khẩu. Hãy đặt mật khẩu riêng trước khi sử dụng dự án.",
              )}
        </p>
        {user && !done && !uncertain && (
          <form className="login-form" onSubmit={submit}>
            <p className="password-account">{user.email}</p>
            <label>
              {t("Mật khẩu hiện tại")}
              <input
                name="currentPassword"
                type="password"
                required
                maxLength={1024}
                autoComplete="current-password"
                disabled={busy}
              />
            </label>
            <label>
              {t("Mật khẩu mới")}
              <input
                name="newPassword"
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            <label>
              {t("Xác nhận mật khẩu mới")}
              <input
                name="confirmation"
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
            <p className="form-help">
              {t("Ít nhất 8 ký tự. Không dùng lại mật khẩu tạm.")}
            </p>
            <button className="login-submit" disabled={busy}>
              {busy ? t("Đang lưu…") : t("Lưu mật khẩu mới")}
            </button>
          </form>
        )}
        {!user && !message && <p role="status">{t("Đang xác thực…")}</p>}
        {message && (
          <p className="error-text" role="alert">
            {message}
          </p>
        )}
        {!user && message && (
          <button
            className="admin-outline"
            onClick={() => {
              setMessage("");
              setAttempt((value) => value + 1);
            }}
          >
            {t("Thử lại")}
          </button>
        )}
        <button className="password-leave" disabled={busy} onClick={leave}>
          {done || uncertain ? t("Đăng nhập lại") : t("Đăng xuất")}
        </button>
      </div>
    </main>
  );
}
