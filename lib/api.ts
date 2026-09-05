const configuredBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api").replace(/\/+$/, "");
export const API_BASE = configuredBase.endsWith("/api") ? configuredBase : `${configuredBase}/api`;
const TOKEN_KEY = "sentinel.access-token";
export const SESSION_EXPIRED_EVENT = "sentinel:session-expired";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function getToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.";
}

export function isAborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${path.replace(/^\/?api\//, "").replace(/^\//, "")}`, {
      ...options,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    if (isAborted(error)) throw error;
    throw new ApiError("Không kết nối được backend. Kiểm tra dịch vụ API và cấu hình địa chỉ kết nối.", 0);
  }

  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (!response.ok) {
    const detail = data && typeof data === "object" && "detail" in data ? data.detail : null;
    const message = typeof detail === "string" ? detail : Array.isArray(detail)
      ? detail.map((item: { msg?: string }) => item.msg || "Dữ liệu chưa hợp lệ").join("; ")
      : `Yêu cầu thất bại (HTTP ${response.status}). Vui lòng thử lại.`;
    if (response.status === 401 && token && getToken() === token) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(message, response.status);
  }
  return data as T;
}
