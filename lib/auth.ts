"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch, clearToken, errorMessage, getToken, isAborted, SESSION_EXPIRED_EVENT } from "./api";
import type { Role, User } from "./types";

export function useSession(role: Role) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const loginPath = role === "admin" ? "/admin/login" : "/login";

  useEffect(() => {
    const controller = new AbortController();
    setSessionError("");
    function expired() {
      setUser(null);
      router.replace(`${loginPath}?expired=1`);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    if (!getToken()) {
      router.replace(loginPath);
    } else {
      apiFetch<User>("/auth/me", { signal: controller.signal }).then((current) => {
        if (controller.signal.aborted) return;
        if (!current.isActive) { clearToken(); expired(); return; }
        if (current.role !== role) {
          router.replace(current.role === "admin" ? "/admin" : "/");
          return;
        }
        setUser(current);
      }).catch((error: unknown) => {
        if (isAborted(error)) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearToken(); expired();
        } else setSessionError(errorMessage(error));
      });
    }
    return () => {
      controller.abort();
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    };
  }, [attempt, loginPath, role, router]);

  const logout = useCallback(async () => {
    try { await apiFetch("/auth/logout", { method: "POST" }); }
    catch { /* End the local session even when the API is temporarily unreachable. */ }
    finally { clearToken(); setUser(null); router.replace(loginPath); }
  }, [loginPath, router]);

  return { user, sessionError, logout, retrySession: () => setAttempt((value) => value + 1) };
}
