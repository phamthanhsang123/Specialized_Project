"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Xác thực quản trị thành công. Đang mở Admin Console…");
    window.setTimeout(() => router.push("/admin"), 500);
  }
  return <main className="login-page admin-login-page">
    <section className="login-art"><div className="login-brand"><span>✦</span> sentinel <small>AI CODE REVIEW</small></div><div className="login-copy"><p>ADMINISTRATION CONSOLE</p><h1>Quản trị hệ thống<br />một cách có kiểm soát.</h1><span>Quản lý Developer, project, chỉ số AI và lịch sử hoạt động của toàn hệ thống.</span></div><div className="login-feature"><b>Quyền Admin được ghi nhận trong Audit Log.</b><span>RBAC · User management · System analytics</span></div></section>
    <section className="login-form-wrap"><form className="login-form" onSubmit={submit}><div className="login-mobile-brand">✦ sentinel</div><p className="form-eyebrow">ADMINISTRATOR ACCESS</p><h2>Đăng nhập quản trị</h2><p className="form-subtitle">Chỉ dành cho tài khoản có vai trò Admin.</p><div className="admin-login-badge">♙ ADMIN · SYSTEM CONTROL</div><label>Email quản trị<input required type="email" defaultValue="admin@sentinel.local" placeholder="admin@email.com" /></label><label>Mật khẩu<input required type="password" defaultValue="password" placeholder="••••••••" /></label><div className="login-options"><label><input type="checkbox" defaultChecked /> Ghi nhớ đăng nhập</label><a href="/login">Đăng nhập Developer</a></div><button className="login-submit" type="submit">Mở Admin Console <span>→</span></button>{message && <p className="login-message">✓ {message}</p>}<div className="demo-credential"><b>Demo quản trị</b><span>admin@sentinel.local · password</span></div></form></section>
  </main>;
}
