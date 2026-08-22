# Sentinel — AI Code Review Frontend

Giao diện dành cho đề tài **Website hỗ trợ phân tích, sửa lỗi và kiểm thử mã nguồn bằng AI**. Frontend được thiết kế bằng Next.js + TypeScript, mặc định có dữ liệu demo để nhóm trình bày giao diện trước khi các service hoàn thiện.

## Chạy dự án

Yêu cầu Node.js 20 LTS trở lên.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Mở `http://localhost:3000`. Toàn bộ file mã nguồn dùng UTF-8; thẻ HTML đã đặt `lang="vi"`, CSS dùng `Be Vietnam Pro` cùng các fallback Unicode để hiển thị tiếng Việt ổn định.

## Phạm vi của Thành viên 1

- Dashboard project, upload ZIP/Python source.
- Code Viewer 3 cột: file tree, code có line number/highlight, danh sách issue.
- Issue dashboard: severity, confidence, rule code, trạng thái.
- AI review: explanation, original/replacement code, diff, Accept/Reject.
- Test report: before/after, pass/fail, Docker sandbox status.
- Version timeline và rollback action.

Nút bấm hiện thao tác với dữ liệu demo. Khi backend hoàn thiện, thay phần mock trong `lib/mock-data.ts` bằng request qua `lib/api.ts`.

## Hợp đồng tích hợp liên thành viên

TV2 nên cung cấp các endpoint sau (base URL từ `NEXT_PUBLIC_API_BASE_URL`):

```text
POST /projects/{id}/upload       multipart/form-data: file
POST /projects/{id}/scan
GET  /projects/{id}/files
GET  /projects/{id}/files/content?path=app/auth/login.py
GET  /projects/{id}/issues
GET  /issues/{id}/proposal
POST /issues/{id}/accept
POST /issues/{id}/reject
POST /projects/{id}/apply
POST /projects/{id}/test
GET  /projects/{id}/test-runs
GET  /projects/{id}/versions
POST /projects/{id}/rollback
```

### Schema issue từ TV3 qua TV2

```json
{
  "id": "ISS-001",
  "filePath": "app/auth/login.py",
  "lineStart": 9,
  "lineEnd": 9,
  "ruleCode": "B608",
  "type": "SQL Injection",
  "severity": "CRITICAL",
  "description": "Câu truy vấn SQL được tạo bằng phép nối chuỗi.",
  "confidence": 0.98,
  "status": "PENDING",
  "explanation": "…",
  "impact": "…"
}
```

### Schema patch proposal từ TV3

```json
{
  "issueId": "ISS-001",
  "originalCode": "query = ...",
  "replacementCode": "query = ...",
  "reason": "Dùng parameterized query…",
  "patchText": "--- a/app/auth/login.py ..."
}
```

### Schema test run từ TV4 qua TV2

```json
{
  "id": "run-22",
  "version": "v2",
  "status": "PASS",
  "total": 20,
  "passed": 20,
  "failed": 0,
  "errors": 0,
  "duration": "2.84s",
  "createdAt": "2026-08-22T10:42:00+07:00"
}
```

## Các file quan trọng

- `app/page.tsx`: toàn bộ trang dashboard tương tác.
- `app/globals.css`: thiết kế responsive, typography và màu sắc.
- `lib/types.ts`: kiểu dữ liệu dùng chung giữa frontend/API.
- `lib/api.ts`: fetch wrapper, nơi nối FastAPI.
- `lib/mock-data.ts`: fixture phục vụ demo tuần 3–4.

## Lưu ý bảo mật

Frontend chỉ yêu cầu upload; TV2/TV4 phải xử lý giải nén và chạy source trong Docker sandbox. Không được chạy Python người dùng upload trực tiếp trên máy chủ hay trong browser.
