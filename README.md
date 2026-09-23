# Sentinel — phân tích, review và kiểm thử mã nguồn

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

| Vai trò   | Email                    | Mật khẩu demo |
| --------- | ------------------------ | ------------- |
| Admin     | admin@sentinel.local     | password      |
| Developer | developer@sentinel.local | password      |

Seed chỉ tạo tài khoản chưa tồn tại, không đặt lại mật khẩu. `SEED_DEMO_DATA=false` tắt tài khoản demo; dùng `BOOTSTRAP_ADMIN_EMAIL` và `BOOTSTRAP_ADMIN_PASSWORD` để tạo Admin đầu tiên. Admin tạo Developer qua giao diện. Token được lưu dạng hash, hết hạn sau 24 giờ mặc định; đăng xuất/khóa tài khoản thu hồi token. Developer chỉ truy cập project của mình, Admin xem toàn hệ thống.

## Luồng sử dụng

1. Đăng nhập Developer, tạo/chọn project.
2. Chọn mã nguồn Python/JavaScript/TypeScript, cả thư mục source, hoặc tải `.zip` (tổng tối đa 10 MB và 500 tệp). Đường dẫn thư mục được giữ nguyên; `node_modules`, `.git` và thư mục build bị bỏ qua. Backend tự nhận diện ngôn ngữ, lưu source và tạo phiên bản mới cho mỗi lần tải.
3. Chọn **phân tích tĩnh** hoặc **AI** rồi quét; chọn issue để xem vị trí, giải thích và diff.
4. Duyệt Accept/Reject, bấm Apply. Chỉ patch được chấp nhận, còn khớp source và hợp lệ cú pháp mới được áp dụng. Source thay đổi thì quét/duyệt lại.
5. Với dự án Python, thêm pytest hoặc sinh test AI khi đã cấu hình rồi đọc/chỉnh test trước khi chạy. Với JavaScript/TypeScript, dùng **Xem trước giao diện** để chạy và so sánh trực tiếp.
6. Chạy test trước/sau bản sửa; xem log thực tế. Rollback tạo một phiên bản mới chứa source được khôi phục.
7. Khi cấu hình Daytona, mở **Kiểm thử → Xem trước giao diện** để chạy phiên bản trước và sau trong hai sandbox riêng.
8. Có thể đổi tên, chuyển project vào thùng rác, khôi phục hoặc xóa vĩnh viễn project thuộc sở hữu của mình.

Bạn không cần nén lại source sau mỗi lần sửa. Bấm **Tải thư mục**, chọn thư mục project hiện tại rồi xác nhận; trình duyệt sẽ gửi các tệp source được hỗ trợ và giữ đường dẫn thư mục con. Vì giới hạn bảo mật của trình duyệt, khi muốn đồng bộ thay đổi mới bạn cần chọn lại thư mục; mỗi lần tải sẽ thay source hiện tại và vẫn giữ phiên bản cũ để rollback.

Phân tích tĩnh dùng Python AST và quy tắc giới hạn, không gọi LLM hay tự đặt độ tin cậy. SQL chưa đủ ngữ cảnh chỉ có finding, không tự tạo patch. Compile chỉ kiểm tra cú pháp; vẫn cần review và kiểm thử để xác định hành vi.

## Test Engine bằng Docker

Mở Docker Desktop với Linux containers, rồi chạy từ thư mục dự án:

```powershell
docker build -t sentinel-test-runner:local backend/sandbox
```

Runner dùng pytest thật, tắt mạng, source/root filesystem chỉ đọc, user không root, bỏ capabilities; giới hạn CPU, RAM, PID, thời gian và tmpfs. Wrapper trong image xuất JUnit trước khi container dừng. Không mount thư mục host để ghi report, không thực thi source upload trực tiếp trên máy chủ API.

Thiếu Docker/image/test thì API báo lỗi, không tạo PASS giả. Image mặc định có standard library + pytest; project cần thư viện khác phải build image riêng và đặt `SANDBOX_IMAGE`. Sandbox này cần được đánh giá cách ly riêng trước khi dùng như dịch vụ công khai đa khách hàng.

VERIFIED nghĩa là vượt qua bộ test đã chạy, không phải hết mọi lỗi. Toàn bộ test bị skip hoặc không thu thập được test không đủ để xác minh. Log ghi số test bị skip.

## Xem trước giao diện bằng Daytona

Tạo API key tại [Daytona Dashboard](https://app.daytona.io/dashboard/keys), thêm vào `backend/.env`, rồi khởi động lại backend:

```dotenv
DAYTONA_API_KEY=
DAYTONA_API_URL=https://app.daytona.io/api
PREVIEW_TTL_MINUTES=30
```

Tab **Kiểm thử → Xem trước giao diện** nhận runtime, lệnh cài đặt, lệnh chạy và cổng web. Backend tải snapshot phiên bản trước cùng source hiện tại vào hai Daytona sandbox độc lập, khởi động ứng dụng và trả URL ký tạm thời để hiển thị cạnh nhau. JavaScript, TypeScript và Python đều có preset; có thể sửa lệnh theo framework thực tế. Nếu Daytona hiện trang `Preview URL Warning`, mở bản xem trước toàn màn hình và chọn **Continue to Preview** trước khi xem trong khung so sánh.

Mỗi sandbox có thời hạn và tự hết hạn. Nút **Dừng bản xem trước** xóa ngay hai sandbox. API key chỉ nằm ở backend; mã nguồn chỉ được gửi tới Daytona khi người dùng bấm chạy xem trước. Hệ thống lưu project Python, JavaScript và TypeScript; quét AI đọc các loại source này. Patch tự động được kiểm tra cú pháp cho Python và JavaScript thuần, còn TypeScript/JSX hiện chỉ trả finding để người dùng sửa thủ công.

## AI tùy chọn

Website cho phép chọn Google Gemini, OpenAI hoặc xAI Grok tại thời điểm chạy. Khóa chỉ lưu trong `backend/.env`; giao diện không nhận và không hiển thị khóa. Cấu hình ít nhất một nhóm biến:

- OpenAI: tạo khóa tại [OpenAI API Keys](https://platform.openai.com/api-keys).
- xAI Grok: tạo khóa tại [xAI Console API Keys](https://console.x.ai/team/default/api-keys).
- `AI_DEFAULT_PROVIDER=gemini` giữ Gemini là lựa chọn mặc định; OpenAI và Grok chỉ được gọi khi người dùng chủ động chọn chúng.

```dotenv
AI_DEFAULT_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna

XAI_API_KEY=
XAI_MODEL=grok-4.6
```

Gemini có Free Tier cho một số model và phù hợp để chạy demo. Dữ liệu gửi bằng Free Tier có thể được Google dùng để cải thiện sản phẩm, vì vậy chỉ dùng mã mẫu hoặc mã không nhạy cảm. OpenAI và Grok API tính phí theo token. Các dịch vụ đều được gọi qua Chat Completions tương thích và đầu ra JSON.

Chỉ khi bấm thao tác AI, source/log mới được gửi tới dịch vụ cấu hình. Không có khóa/model vẫn dùng phân tích tĩnh; không tự gọi API có tính phí khi khởi động. AI hỗ trợ phát hiện/giải thích lỗi, sinh patch, sinh pytest và giải thích log. JSON, vị trí patch, source hash và cú pháp đều được kiểm tra. AI không tự Apply hay thay đổi kết quả pytest. Test AI được lưu tên mới, không ghi đè test người dùng.

Admin chỉ hiển thị chỉ số AI sau khi có kết quả đánh giá được lưu; không dùng số giả. Thống kê tài khoản/project/issue/test run lấy từ DB. Bộ dữ liệu hiện tại là đường cơ sở nhỏ và cần mở rộng trước báo cáo cuối.

## Đánh giá khả năng phát hiện lỗi

Bộ dữ liệu ban đầu trong `evaluation/` có 20 mẫu Python, gồm 10 lỗi gán nhãn và 10 mẫu đối chứng. Chạy đường cơ sở phân tích tĩnh:

```powershell
backend\.venv\Scripts\python.exe evaluation\evaluate.py --mode static --output-prefix evaluation\results\static-baseline
```

Sau khi cấu hình khóa trong `backend/.env`, chạy cùng bộ dữ liệu bằng LLM thật và chọn nhà cung cấp:

```powershell
backend\.venv\Scripts\python.exe evaluation\evaluate.py --mode ai --provider gemini
```

Công cụ xuất JSON chi tiết và báo cáo Markdown gồm TP, FP, FN, Precision, Recall, F1, độ chính xác mức độ lỗi và tỉ lệ đề xuất đúng cú pháp. Xem hướng dẫn và giới hạn tại [evaluation/README.md](evaluation/README.md).

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
