"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, clearToken, errorMessage, getToken, isAborted, setToken } from "../../lib/api";
import type { LoginResponse, User } from "../../lib/types";
export default function LoginForm({
  admin = false
}: {
  admin?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (new URLSearchParams(window.location.search).has("expired")) setMessage("Phiên đăng nhập đã hết hạn hoặc tài khoản đã bị khóa. Vui lòng đăng nhập lại.");
    if (getToken()) {
      apiFetch<User>("/auth/me", {
        signal: controller.signal
      }).then(user => {
        if (!controller.signal.aborted) router.replace(user.role === "admin" ? "/admin" : "/");
      }).catch((error: unknown) => {
        if (!isAborted(error)) setMessage(errorMessage(error));
      });
    }
    return () => controller.abort();
  }, [router]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const result = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(data.get("email")).trim(),
          password: String(data.get("password"))
        })
      });
      setToken(result.token);
      if (admin && result.user.role !== "admin") {
        try {
          await apiFetch("/auth/logout", {
            method: "POST"
          });
        } finally {
          clearToken();
        }
        setMessage("Tài khoản này không có quyền Admin. Hãy dùng trang đăng nhập Developer.");
        return;
      }
      router.replace(result.user.role === "admin" ? "/admin" : "/");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return <main className={`login-page${admin ? " admin-login-page" : ""}`}>
    <section className="login-art">
      <div className="login-brand"><span>✦</span> sentinel <small>AI CODE REVIEW</small></div>
      <div className="login-copy">
        <p>{admin ? "ADMINISTRATION CONSOLE" : "NỀN TẢNG PHÁT TRIỂN AN TOÀN"}</p>
        <h1>{admin ? <>Quản trị hệ thống<br />một cách có kiểm soát.</> : <>Review mã nguồn<br />trước khi lỗi trở thành sự cố.</>}</h1>
        <span>{admin ? "Quản lý tài khoản, project và hoạt động từ dữ liệu hệ thống." : "Phân tích, duyệt đề xuất sửa và kiểm thử mã Python theo từng phiên bản."}</span>
      </div>
      <div className="login-feature">
        <b>{admin ? "Truy cập theo quyền được cấp." : "Developer luôn là người ra quyết định."}</b>
        <span>Review đề xuất · Áp dụng patch · Kiểm thử · Khôi phục phiên bản</span>
      </div>
    </section>
    <section className="login-form-wrap">
      <form className="login-form" onSubmit={submit}>
        <p className="form-eyebrow">{admin ? "ADMINISTRATOR ACCESS" : "CHÀO MỪNG TRỞ LẠI"}</p>
        <h2>{admin ? "Đăng nhập quản trị" : "Đăng nhập không gian làm việc"}</h2>
        <p className="form-subtitle">Sử dụng tài khoản được quản trị viên cấp cho bạn.</p>
        <div className="role-picker">
          <Link className={!admin ? "selected" : ""} href="/login">
            <b>⌘ Developer</b>
            <small>Phân tích và sửa mã nguồn</small>
          </Link>
          <Link className={admin ? "selected" : ""} href="/admin/login">
            <b>♙ Admin</b>
            <small>Quản lý hệ thống</small>
          </Link>
        </div>
        <label>Email<input name="email" required type="email" autoComplete="username" placeholder="tenban@email.com" disabled={busy} /></label>
        <label>Mật khẩu<input name="password" required type="password" autoComplete="current-password" placeholder="Nhập mật khẩu" disabled={busy} /></label>
        <p className="form-help">Nếu chưa có tài khoản hoặc quên mật khẩu, hãy liên hệ quản trị viên.</p>
        <button className="login-submit" type="submit" disabled={busy}>
          {busy ? "Đang xác thực…" : "Đăng nhập"}
          <span aria-hidden="true">→</span>
        </button>
        {message && <p className="login-message error-text" role="alert">{message}</p>}
      </form>
    </section>
  </main>;
}
