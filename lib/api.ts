import { t } from "./i18n";
const configuredBase = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api"
).replace(/\/+$/, "");
export const API_BASE = configuredBase.endsWith("/api")
  ? configuredBase
  : `${configuredBase}/api`;
const TOKEN_KEY = "sentinel.access-token";
export const SESSION_EXPIRED_EVENT = "sentinel:session-expired";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly uncertain = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getToken(): string | null {
  return typeof window === "undefined"
    ? null
    : window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? t(error.message)
    : t("Có lỗi xảy ra. Vui lòng thử lại.");
}

export function isAborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export type ApiOptions = RequestInit & {
  timeoutMs?: number;
  sessionBound?: boolean;
};
const activeRequests = new Set<AbortController>();
export function abortSessionRequests() {
  for (const controller of activeRequests) controller.abort();
}

export async function apiFetch<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const {
    timeoutMs = /\/(ai-scan|ai-proposal|generate|explain|test)$/.test(path)
      ? 180000
      : 30000,
    sessionBound = true,
    signal,
    ...request
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  if (sessionBound) activeRequests.add(controller);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const mutation = !["GET", "HEAD"].includes(
    (request.method ?? "GET").toUpperCase(),
  );
  try {
    const headers = new Headers(options.headers);
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData))
      headers.set("Content-Type", "application/json");
    const response = await fetch(
      `${API_BASE}/${path.replace(/^\/?api\//, "").replace(/^\//, "")}`,
      {
        ...request,
        headers,
        signal: controller.signal,
        cache: "no-store",
      },
    );

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      const detail =
        data && typeof data === "object" && "detail" in data
          ? data.detail
          : null;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail
                .map(
                  (item: { msg?: string }) =>
                    item.msg || t("Dữ liệu chưa hợp lệ"),
                )
                .join("; ")
            : t("Yêu cầu thất bại (HTTP {{status}}). Vui lòng thử lại.", {
                status: response.status,
              });
      if (response.status === 401 && token && getToken() === token) {
        clearToken();
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
      throw new ApiError(
        message,
        response.status,
        mutation && response.status >= 500,
      );
    }
    return data as T;
  } catch (failure) {
    if (timedOut)
      throw new ApiError(
        "Yêu cầu quá thời gian chờ. Máy chủ có thể vẫn đang xử lý; không tự gửi lại thao tác.",
        0,
        mutation,
      );
    if (isAborted(failure) || controller.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (failure instanceof ApiError) throw failure;
    throw new ApiError(
      "Không kết nối được backend. Kiểm tra dịch vụ API và cấu hình địa chỉ kết nối.",
      0,
      mutation,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    activeRequests.delete(controller);
  }
}
