/**
 * Điểm tích hợp dành cho TV2/TV3/TV4. Khi NEXT_PUBLIC_API_BASE_URL tồn tại,
 * thay các dữ liệu mock bằng fetch tới các endpoint FastAPI đã thống nhất.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  if (!API_BASE) throw new Error("Backend chưa được cấu hình. Ứng dụng đang dùng dữ liệu demo.");
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
