# Sentinel Backend

Hướng dẫn chạy/config: [README chính](../README.md).

API dưới `/api`; trừ health/login, cần `Authorization: Bearer <token>`. Alias project/issue cũ vẫn kiểm tra quyền.

```text
POST /api/auth/login                         {email,password}
GET  /api/auth/me
POST /api/auth/logout
GET  /api/capabilities
GET  /api/projects
POST /api/projects                           {name,language?}
GET  /api/projects/{id}
POST /api/projects/{id}/upload                multipart: file (.py/.zip)
GET  /api/projects/{id}/files
GET  /api/projects/{id}/files/content?path=...
POST /api/projects/{id}/scan                  phân tích tĩnh
POST /api/projects/{id}/ai-scan
GET  /api/projects/{id}/issues
GET  /api/issues/{id}
GET  /api/issues/{id}/proposal
POST /api/issues/{id}/ai-proposal
POST /api/issues/{id}/accept
POST /api/issues/{id}/reject
POST /api/projects/{id}/apply
GET  /api/projects/{id}/test-cases
POST /api/projects/{id}/test-cases            {name,code}, cập nhật nếu trùng name
POST /api/projects/{id}/test-cases/generate   sinh test AI với tên mới
POST /api/projects/{id}/test
GET  /api/projects/{id}/test-runs
GET  /api/projects/{id}/test-results          alias test-runs
POST /api/projects/{id}/test-runs/{runId}/explain
GET  /api/projects/{id}/versions
POST /api/projects/{id}/rollback?version=v2
GET  /api/admin/overview                     chỉ Admin
POST /api/admin/users                       {fullName,email,password}
PATCH /api/admin/users/{id}                  {isActive}
```

Issue ID là opaque, không suy ra proposal từ ISS-001. Confidence có thể null. Issue status: PENDING/ACCEPTED/REJECTED/APPLIED/VERIFIED/FAILED. Test output chứa log và số skip. Rollback luôn tạo phiên bản mới.

401: đăng nhập lại; 403: sai vai trò; 404: không có quyền/không tồn tại; 409: xung đột source/trạng thái/email; 422: đầu vào hoặc kết quả AI sai; 503: Docker/AI chưa sẵn sàng. Không diễn giải lỗi thành thành công.
