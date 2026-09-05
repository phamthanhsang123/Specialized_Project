# Quản trị Sentinel

Giao diện `/admin` giữ 3 mục: Người dùng, Dự án, Nhật ký hoạt động. Toàn bộ nhãn mới có tiếng Việt/Anh qua i18next; font Be Vietnam Pro được đóng gói cục bộ.

## Sử dụng

- Bấm tên Developer để xem chi tiết, sửa họ tên/email hoặc đặt lại mật khẩu. Email trùng bị chặn ở API. Danh sách người dùng tìm/lọc trước rồi phân trang 10 dòng.
- Khóa/mở khóa cần xác nhận và có thể nhập lý do. Khóa thu hồi phiên đăng nhập, không xóa tài khoản hay dự án.
- Đặt lại mật khẩu: nhập và xác nhận mật khẩu tạm (8–128 ký tự), chuyển riêng cho đúng người dùng. API thu hồi mọi phiên cũ và đặt `mustChangePassword=true`. Tài khoản bị khóa vẫn bị khóa.
- Developer đăng nhập bằng mật khẩu tạm được chuyển tới `/change-password`. API chỉ cho phép xem phiên, đăng xuất và đổi mật khẩu; truy cập dự án bị chặn. Đổi xong thu hồi mọi phiên, phải đăng nhập lại bằng mật khẩu mới. Không ghi mật khẩu vào nhật ký.
- Dự án: tìm tên/chủ sở hữu, lọc Developer, xem thông tin và kết quả test gần nhất. Phiên bản đã test được hiển thị riêng, không mặc định là phiên bản hiện tại. Không cung cấp mã nguồn hoặc output test trong API chi tiết Admin mới.
- Nhật ký: lọc người thực hiện/hành động/từ ngày/đến ngày; bấm sự kiện để xem chi tiết. Ngày được hiểu theo múi giờ trình duyệt và chuyển sang UTC trước khi gửi API. Ngày kết thúc bao gồm toàn bộ ngày đó.

## Hợp đồng API (tiền tố `/api`)

| Endpoint | Quyền / dữ liệu |
| --- | --- |
| `GET /admin/overview` | Admin; dữ liệu tài khoản và danh sách dự án hiện có |
| `PUT /admin/users/{id}/profile` | Admin; `{fullName, email}`; 409 nếu trùng email |
| `PATCH /admin/users/{id}` | Admin; `{isActive, reason?}` |
| `POST /admin/users/{id}/reset-password` | Admin; `{temporaryPassword}`; không trả lại mật khẩu |
| `GET /admin/projects/{id}` | Admin; metadata và `latestTest`, có thể null |
| `GET /admin/activities` | Admin; `page`, `page_size` (tối đa 100), `actor_id`, `action`, `date_from`, `date_to` |
| `POST /auth/change-password` | Phiên hợp lệ; `{currentPassword, newPassword}`; 400 nếu mật khẩu hiện tại sai hoặc dùng lại mật khẩu cũ |

Nhật ký trả `{items,total,page,pageSize,actors,actions}`. Bộ lọc áp dụng trên DB trước phân trang, không chỉ lọc 20 sự kiện gần nhất. `date_from` bao gồm, `date_to` không bao gồm. Bản ghi phiên bản/kiểm thử cũ được hợp nhất với AuditEvent. Test cũ không có người thực hiện được ghi “Hệ thống”, không suy đoán là chủ dự án.

Mã sự kiện: `USER_CREATED`, `USER_UPDATED`, `USER_LOCKED`, `USER_UNLOCKED`, `PASSWORD_RESET`, `PASSWORD_CHANGED`, `ACCEPTED`, `REJECTED`, `VERSION_SAVED`, `TEST_RUN`. Các thao tác tài khoản và nhật ký được commit cùng giao dịch.

Admin không được gọi các API thay đổi mã nguồn, chấp nhận/từ chối bản sửa, chạy test, rollback hoặc AI; server trả 403. API đọc project cũ vẫn giữ tương thích với quyền Admin hiện có. Các API quản trị chỉ quản lý đối tượng Developer, không đổi role hoặc sửa Admin.

## Khởi động và kiểm thử

Backend thêm cột `users.must_change_password` theo migration cộng thêm, mặc định false, không xóa dữ liệu. Khởi động lại Uvicorn để áp dụng; sao lưu SQLite trước khi nâng cấp môi trường có dữ liệu thật. Không chạy migration bằng cách xóa DB.

- Backend: `python -m pytest -q` trong thư mục backend, dùng môi trường `.venv`.
- Frontend: `npm run typecheck`, `npm run check:i18n`, `npm run test:unit`, `npm run test:ui`, `npm run build`.
- Test backend dùng SQLite bộ nhớ, UI dùng API giả lập; không đặt lại mật khẩu hay khóa tài khoản thật. Smoke login thật có thể bật `UI_LIVE_SMOKE=1` khi có tài khoản seed.

Khi POST bị mất kết nối/timeout, UI không tự gửi lại. Với thay đổi Admin, phải tải và kiểm tra dữ liệu trước khi thao tác tiếp. Với đổi mật khẩu chưa rõ kết quả, quay lại đăng nhập bằng mật khẩu mới hoặc mật khẩu tạm; liên hệ Admin nếu cần.

## Giới hạn chủ động

Người dùng/dự án vẫn tải qua overview rồi phân trang tại trình duyệt, phù hợp quy mô đồ án; nếu triển khai lớn cần API danh sách phân trang và truy vấn đếm tổng hợp. Nhật ký đã phân trang ở máy chủ. Không có gửi email đặt lại mật khẩu, xóa tài khoản hay tự động đổi role.
