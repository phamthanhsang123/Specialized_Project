# Sentinel — phân tích, review và kiểm thử Python

Next.js + FastAPI + SQLAlchemy. Giao diện Developer và Admin dùng API và database; không dùng dữ liệu mẫu trong luồng chạy.

## Chạy trên máy

Frontend cần Node.js 20+; backend dùng Python 3.11/3.12.

```powershell
# Terminal 1, từ thư mục dự án
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env  # Chỉ làm nếu chưa có .env
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2, từ thư mục dự án
npm install
Copy-Item .env.example .env.local  # Chỉ làm nếu chưa có .env.local
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000). API docs: [http://localhost:8000/docs](http://localhost:8000/docs).

Backend `.env.example` bật chế độ demo **có đăng nhập thật**:

| Vai trò | Email | Mật khẩu demo |
|---|---|---|
| Admin | admin@sentinel.local | password |
| Developer | developer@sentinel.local | password |

Seed chỉ tạo tài khoản chưa tồn tại, không đặt lại mật khẩu. `SEED_DEMO_DATA=false` tắt tài khoản demo; dùng `BOOTSTRAP_ADMIN_EMAIL` và `BOOTSTRAP_ADMIN_PASSWORD` để tạo Admin đầu tiên. Admin tạo Developer qua giao diện. Token được lưu dạng hash, hết hạn sau 24 giờ mặc định; đăng xuất/khóa tài khoản thu hồi token. Developer chỉ truy cập project của mình, Admin xem toàn hệ thống.

## Luồng sử dụng

1. Đăng nhập Developer, tạo/chọn project.
2. Chọn một/nhiều tệp `.py`, chọn cả thư mục source, hoặc tải `.zip` (tổng tối đa 10 MB và 500 file Python). Đường dẫn thư mục được giữ nguyên; backend lưu source và tạo phiên bản mới cho mỗi lần tải.
3. Chọn **phân tích tĩnh** hoặc **AI** rồi quét; chọn issue để xem vị trí, giải thích và diff.
4. Duyệt Accept/Reject, bấm Apply. Chỉ patch được chấp nhận, còn khớp source và hợp lệ cú pháp mới được áp dụng. Source thay đổi thì quét/duyệt lại.
5. Thêm pytest hoặc sinh test AI khi đã cấu hình. Đọc/chỉnh test trước khi chạy.
6. Chạy test trước/sau bản sửa; xem log thực tế. Rollback tạo một phiên bản mới chứa source được khôi phục.

Bạn không cần nén lại source sau mỗi lần sửa. Bấm **Tải thư mục**, chọn thư mục project hiện tại rồi xác nhận; trình duyệt sẽ gửi các tệp `.py` và giữ đường dẫn thư mục con. Vì giới hạn bảo mật của trình duyệt, khi muốn đồng bộ thay đổi mới bạn cần chọn lại thư mục; mỗi lần tải sẽ thay source hiện tại và vẫn giữ phiên bản cũ để rollback.

Phân tích tĩnh dùng Python AST và quy tắc giới hạn, không gọi LLM hay tự đặt độ tin cậy. SQL chưa đủ ngữ cảnh chỉ có finding, không tự tạo patch. Compile chỉ kiểm tra cú pháp; vẫn cần review và kiểm thử để xác định hành vi.

## Test Engine bằng Docker

Mở Docker Desktop với Linux containers, rồi chạy từ thư mục dự án:

```powershell
docker build -t sentinel-test-runner:local backend/sandbox
```

Runner dùng pytest thật, tắt mạng, source/root filesystem chỉ đọc, user không root, bỏ capabilities; giới hạn CPU, RAM, PID, thời gian và tmpfs. Wrapper trong image xuất JUnit trước khi container dừng. Không mount thư mục host để ghi report, không thực thi source upload trực tiếp trên máy chủ API.

Thiếu Docker/image/test thì API báo lỗi, không tạo PASS giả. Image mặc định có standard library + pytest; project cần thư viện khác phải build image riêng và đặt `SANDBOX_IMAGE`. Sandbox này cần được đánh giá cách ly riêng trước khi dùng như dịch vụ công khai đa khách hàng.

VERIFIED nghĩa là vượt qua bộ test đã chạy, không phải hết mọi lỗi. Toàn bộ test bị skip hoặc không thu thập được test không đủ để xác minh. Log ghi số test bị skip.

## AI tùy chọn

Trong `backend/.env` đặt `AI_API_KEY`, `AI_MODEL`, và tùy chọn `AI_BASE_URL` (mặc định `https://api.openai.com/v1`). Dịch vụ cần hỗ trợ [Chat Completions với JSON mode](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Chỉ khi bấm thao tác AI, source/log mới được gửi tới dịch vụ cấu hình. Không có khóa/model vẫn dùng phân tích tĩnh; không tự gọi API có tính phí khi khởi động. AI hỗ trợ phát hiện/giải thích lỗi, sinh patch, sinh pytest và giải thích log. JSON, vị trí patch, source hash và cú pháp đều được kiểm tra. AI không tự Apply hay thay đổi kết quả pytest. Test AI được lưu tên mới, không ghi đè test người dùng.

Chưa có bộ dữ liệu gán nhãn để đo Precision/Recall/F1/Fix success rate; Admin không hiển thị số giả. Thống kê tài khoản/project/issue/test run lấy từ DB.

## Kiểm tra

```powershell
cd backend
.venv\Scripts\python.exe -m pytest tests -q
cd ..
npm run build
```

Test backend dùng DB tạm riêng. Kiểm tra giao thức runner bằng mock Docker không thay thế nghiệm thu Docker thật. Test AI dùng phản hồi mẫu, không dùng API key.

## Database và triển khai

Local mặc định SQLite; MySQL dùng `DATABASE_URL=mysql+pymysql://USER:PASSWORD@HOST:3306/DATABASE`. Startup tạo bảng thiếu và thêm cột tương thích `users.is_active`, `fix_proposals.base_source_hash`, không xóa DB cũ. Snapshot nằm trong `code_versions.snapshot_json`; `source_path` là nhãn logic.

`render.yaml` chỉ triển khai API, chưa cung cấp Docker runner. Khi triển khai thật: tắt demo, dùng DB bền vững và giới hạn CORS theo frontend.

Kế hoạch: [PLAN.md](PLAN.md). API: [backend/README.md](backend/README.md).
