# Kế hoạch hoàn thiện luồng đồ án

Phạm vi dựa trên cả Thẻ 1 và ba hình trong thẻ Sơ đồ của tài liệu đề tài.

## Các bước

- [x] Nhận 9 commit từ `origin/main` trên nhánh `codex/complete-core-workflow`, giữ thay đổi `package-lock.json` có sẵn.
- [x] Sửa ID issue, lifecycle file/issue, patch an toàn và version/rollback.
- [x] Thêm đăng nhập, phiên đăng nhập, phân quyền, quyền sở hữu project và API Admin.
- [x] Nối frontend với API cho project, upload, scan, review, apply, test và rollback.
- [x] Cho phép chọn nhiều tệp hoặc cả thư mục source trực tiếp, giữ đường dẫn tương đối và vẫn hỗ trợ ZIP.
- [x] Triển khai pytest runner trong Docker với giới hạn tài nguyên, log và trạng thái xác minh.
- [x] Thêm adapter AI theo cấu hình; mặc định phân tích tĩnh minh bạch, AI chỉ gọi khi người dùng chọn.
- [x] Kiểm tra hồi quy backend, build frontend và luồng nghiệp vụ.
- [x] Giữ audit độc lập qua rescan/upload/rollback, chặn proposal cũ chưa có source hash.
- [x] Cập nhật hướng dẫn chạy và kết quả xác minh.
- [ ] Nghiệm thu container thật: Docker Desktop trên máy lỗi socket dockerInference, chưa khởi động được Linux engine.
- [ ] Nghiệm thu LLM thật: chưa có AI_API_KEY và AI_MODEL.

## Tiêu chí nghiệm thu

1. Developer không đọc/sửa project của người khác; Admin quản lý tài khoản thật.
2. Scan nhiều project không trùng ID; upload lại và rollback không lỗi khóa ngoại.
3. Chỉ Apply patch đã duyệt, còn khớp source và hợp lệ cú pháp Python.
4. Version giữ được source trước/sau; rollback tạo một phiên bản mới.
5. Kết quả test lấy từ pytest trong container, không tính từ số issue.
6. Không có Docker/dịch vụ AI thì trả thông báo rõ; không giả lập thành công.
7. Giao diện hiển thị lỗi/loading, không còn dùng dữ liệu mẫu như dữ liệu thật.

Không tự deploy, push GitHub hoặc thay đổi khóa dịch vụ. Các chỉ số Precision/Recall/F1 cần bộ dữ liệu gán nhãn riêng; chưa đo thì không hiển thị con số.

## Kết quả kiểm tra ngày 04/09/2026

- 48 kiểm tra backend đạt, database kiểm thử tách khỏi database làm việc.
- Frontend `npm run build` đạt (compile, TypeScript và prerender).
- Trình duyệt Edge headless: đăng nhập, tạo project, upload, scan, Accept, Apply, lưu pytest và rollback đạt; không có lỗi JavaScript.
- Admin tải dữ liệu thật, menu hiển thị ở viewport 390 px.
- API khi thiếu Docker/AI trả 503 và không ghi kết quả giả; proposal cũ bị chặn với 409.
- `git diff --check` đạt. Thay đổi `package-lock.json` có sẵn được giữ nguyên.
- Backend local ở `http://127.0.0.1:8000`, frontend ở `http://localhost:3000`.
- SQLite đã được sao lưu vào `backend/storage/backups/` trước khi cập nhật schema.

Docker: đã thử mở Desktop và đổi tên socket cũ để giữ bản dự phòng, nhưng Windows trả “The file cannot be accessed by the system”; không đổi được socket và không reset/xóa dữ liệu Docker. Cần sửa cài đặt/runtime Docker riêng trước khi build image và chạy nghiệm thu sandbox.

## Kết quả bổ sung ngày 05/09/2026

- 81 kiểm tra backend đạt, gồm upload nhiều file/thư mục, ZIP, tính nguyên tử, giới hạn request và đường dẫn an toàn trên Windows.
- Frontend `npm run build` đạt sau khi thêm bộ chọn file/thư mục và hỗ trợ bàn phím.
- Edge headless chọn thư mục thật: giữ `src/main.py`, `src/lib/helpers.py`, bỏ qua README và lưu thành phiên bản mới `v2`.
- Request upload vượt giới hạn bị chặn với HTTP 413 trước khi FastAPI phân tích multipart; CORS vẫn đúng.
