"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [role, setRole] = useState<"DEVELOPER" | "ADMIN">("DEVELOPER");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Đăng nhập demo thành công. Đang mở không gian làm việc…");
    window.setTimeout(() => router.push(role === "ADMIN" ? "/admin" : "/"), 500);
  }
  return <main className="login-page">
    <section className="login-art"><div className="login-brand"><span>✦</span> sentinel <small>AI CODE REVIEW</small></div><div className="login-copy"><p>NỀN TẢNG PHÁT TRIỂN AN TOÀN</p><h1>Review mã nguồn<br />trước khi lỗi trở thành sự cố.</h1><span>Phân tích, đề xuất sửa và kiểm thử Python với quy trình có kiểm soát.</span></div><div className="login-feature"><b>Developer luôn là người ra quyết định.</b><span>AI tạo patch · Bạn review · Sandbox xác minh</span></div></section>
    <section className="login-form-wrap"><form className="login-form" onSubmit={submit}><div className="login-mobile-brand">✦ sentinel</div><p className="form-eyebrow">CHÀO MỪNG TRỞ LẠI</p><h2>Đăng nhập không gian làm việc</h2><p className="form-subtitle">Sử dụng tài khoản được cấp cho nhóm đồ án.</p><div className="role-picker"><button type="button" className={role === "DEVELOPER" ? "selected" : ""} onClick={() => setRole("DEVELOPER")}><b>⌘ Developer</b><small>Review source & AI fixes</small></button><button type="button" className={role === "ADMIN" ? "selected" : ""} onClick={() => setRole("ADMIN")}><b>♙ Admin</b><small>Quản lý hệ thống</small></button></div><label>Email<input required type="email" defaultValue="developer@sentinel.local" placeholder="tenban@email.com" /></label><label>Mật khẩu<input required type="password" defaultValue="password" placeholder="••••••••" /></label><div className="login-options"><label><input type="checkbox" defaultChecked /> Ghi nhớ đăng nhập</label><button type="button">Quên mật khẩu?</button></div><button className="login-submit" type="submit">Đăng nhập với vai trò {role === "ADMIN" ? "Admin" : "Developer"} <span>→</span></button>{message && <p className="login-message">✓ {message}</p>}<div className="demo-credential"><b>Demo nội bộ</b><span>{role === "ADMIN" ? "admin@sentinel.local" : "developer@sentinel.local"} · password</span></div></form></section>
  </main>;
}
