"use client";
import { t } from "../../lib/i18n";
import { useTranslation } from "react-i18next";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiFetch,
  clearToken,
  errorMessage,
  getToken,
  isAborted,
  setToken,
} from "../../lib/api";
import type { LoginResponse, User } from "../../lib/types";
import { landingPath } from "../../lib/auth";
import { useMessage } from "./use-message";
export default function LoginForm({ admin = false }: { admin?: boolean }) {
  useTranslation();
  const router = useRouter();
  const [message, setMessage] = useMessage();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (new URLSearchParams(window.location.search).has("expired"))
      setMessage(
        "Phiên đăng nhập đã hết hạn hoặc tài khoản đã bị khóa. Vui lòng đăng nhập lại.",
      );
    if (getToken()) {
      apiFetch<User>("/auth/me", {
        signal: controller.signal,
      })
        .then((user) => {
          if (!controller.signal.aborted) router.replace(landingPath(user));
        })
        .catch((error: unknown) => {
          if (!isAborted(error))
            setMessage(
              error instanceof Error ? error.message : errorMessage(error),
            );
        });
    }
    return () => controller.abort();
  }, [router]);
  async function signIn(email: string, password: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });
      setToken(result.token);
      if (admin && result.user.role !== "admin") {
        const revocation = apiFetch("/auth/logout", {
          method: "POST",
          timeoutMs: 5000,
          sessionBound: false,
        });
        clearToken();
        void revocation.catch(() => {});
        setMessage(
          "Tài khoản này không có quyền quản trị. Hãy dùng trang đăng nhập dành cho lập trình viên.",
        );
        return;
      }
      router.replace(landingPath(result.user));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await signIn(String(data.get("email")), String(data.get("password")));
  }
  function quickLogin() {
    void signIn(
      admin ? "admin@sentinel.local" : "developer@sentinel.local",
      "password",
    );
  }
  return (
    <main className={`login-page${admin ? " admin-login-page" : ""}`}>
      <section className="login-art">
        <div className="login-brand">
          <span>✦</span> sentinel <small>DUYỆT MÃ NGUỒN BẰNG AI</small>
        </div>
        <div className="login-copy">
          <p>
            {admin
              ? "BẢNG ĐIỀU KHIỂN QUẢN TRỊ"
              : t("NỀN TẢNG PHÁT TRIỂN AN TOÀN")}
          </p>
          <h1>
            {admin ? (
              <>
                {t("Quản trị hệ thống")}
                <br />
                {t("một cách có kiểm soát.")}
              </>
            ) : (
              <>
                {t("Review mã nguồn")}
                <br />
                {t("trước khi lỗi trở thành sự cố.")}
              </>
            )}
          </h1>
          <span>
            {admin
              ? t(
                  "Quản lý tài khoản, project và hoạt động từ dữ liệu hệ thống.",
                )
              : t(
                  "Phân tích, duyệt đề xuất sửa và kiểm thử mã Python theo từng phiên bản.",
                )}
          </span>
        </div>
        <div className="login-feature">
          <b>
            {admin
              ? t("Truy cập theo quyền được cấp.")
              : t("Developer luôn là người ra quyết định.")}
          </b>
          <span>
            {t(
              "Review đề xuất · Áp dụng patch · Kiểm thử · Khôi phục phiên bản",
            )}
          </span>
        </div>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <p className="form-eyebrow">
            {admin ? "TRUY CẬP QUẢN TRỊ" : t("CHÀO MỪNG TRỞ LẠI")}
          </p>
          <h2>
            {admin
              ? t("Đăng nhập quản trị")
              : t("Đăng nhập không gian làm việc")}
          </h2>
          <p className="form-subtitle">
            {t("Sử dụng tài khoản được quản trị viên cấp cho bạn.")}
          </p>
          <div className="role-picker">
            <Link className={!admin ? "selected" : ""} href="/login">
              <b>⌘ Lập trình viên</b>
              <small>{t("Phân tích và sửa mã nguồn")}</small>
            </Link>
            <Link className={admin ? "selected" : ""} href="/admin/login">
              <b>♙ Quản trị viên</b>
              <small>{t("Quản lý hệ thống")}</small>
            </Link>
          </div>
          <label>
            Email
            <input
              name="email"
              required
              type="email"
              autoComplete="username"
              placeholder="tenban@email.com"
              disabled={busy}
            />
          </label>
          <label>
            {t("Mật khẩu")}
            <input
              name="password"
              required
              type="password"
              autoComplete="current-password"
              placeholder={t("Nhập mật khẩu")}
              disabled={busy}
            />
          </label>
          <p className="form-help">
            {t(
              "Nếu chưa có tài khoản hoặc quên mật khẩu, hãy liên hệ quản trị viên.",
            )}
          </p>
          <button className="login-submit" type="submit" disabled={busy}>
            {busy ? t("Đang xác thực…") : t("Đăng nhập")}
            <span aria-hidden="true">→</span>
          </button>
          <button
            className="demo-login-button"
            type="button"
            disabled={busy}
            onClick={quickLogin}
          >
            {busy
              ? t("Đang xác thực…")
              : admin
                ? t("Vào nhanh bằng tài khoản quản trị mẫu")
                : t("Vào nhanh bằng tài khoản lập trình viên mẫu")}
          </button>
          {message && (
            <p className="login-message error-text" role="alert">
              {message}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
