# Giao diện theo quy trình và đa ngôn ngữ

## Luồng sử dụng

- Developer đăng nhập tại /login → Dự án của tôi → chọn/tạo dự án.
- Trong dự án có bốn bước riêng: Mã nguồn, Vấn đề & bản sửa, Kiểm thử, Lịch sử.
- Chấp nhận đề xuất chỉ lưu quyết định. Áp dụng các đề xuất đã chấp nhận mới thay mã nguồn, tạo phiên bản và chuyển sang Kiểm thử.
- Kiểm thử hiển thị dữ liệu backend; so sánh hai lượt gần nhất chỉ là đối chiếu số liệu, không tự kết luận hồi quy nếu chưa biết bộ test có giống nhau hay không.
- Admin tại /admin có ba khu vực: Người dùng, Dự án, Nhật ký hoạt động. Admin chỉ xem thông tin dự án tổng hợp, không sử dụng chức năng sửa mã của Developer.
- Đăng xuất luôn có ở cuối thanh điều hướng. Trên desktop, thanh điều hướng giữ nguyên khi cuộn phần nội dung.

## i18n

Sử dụng i18next + react-i18next, hai ngôn ngữ hoàn chỉnh cho nội dung giao diện do frontend quản lý: Tiếng Việt (mặc định) và English.

- lib/i18n.ts: khởi tạo resources, fallback, nội suy.
- locales/vi.json, locales/en.json: bản dịch UTF-8.
- app/components/providers.tsx: cung cấp i18n, lưu sentinel.language trong localStorage, cập nhật html lang.
- app/components/language-switcher.tsx: chọn ngôn ngữ tại trang đăng nhập, Developer và Admin.
- app/components/use-message.ts: lưu khóa thông báo và tham số để thông báo đang hiện cũng đổi ngôn ngữ.
- Số lượng dùng count và các biến thể _one/_other của i18next cho tiếng Anh.
- Be Vietnam Pro và JetBrains Mono được đóng gói qua @fontsource, không gọi Google Fonts khi tải trang. Tiếng Việt có bộ glyph riêng và fallback Arial.
- Không dịch hoặc thay đổi mã nguồn, tên tệp, dữ liệu người dùng, nội dung AI và thông báo backend. Để dịch lỗi API đầy đủ, backend cần trả thêm mã lỗi ổn định, frontend ánh xạ mã đó vào catalog.

Thêm ngôn ngữ: tạo catalog mới đủ các khóa, import vào resources trong lib/i18n.ts, thêm supportedLngs, cập nhật kiểm tra ngôn ngữ lưu trong Providers và thêm option trong LanguageSwitcher. Bổ sung locale tương ứng cho dateLabel. Không chỉ thêm option khi chưa có bản dịch.

## Hợp đồng tích hợp giữ nguyên

Backend/AI/test engine vẫn sử dụng các endpoint hiện có, không thay cấu trúc dữ liệu hay phân quyền:

- /auth/login, /auth/me, /auth/logout
- /projects và /projects/:id/{files,upload,scan,ai-scan,issues,apply,test,test-runs,test-cases,versions,rollback}
- /issues/:id và các thao tác accept, reject, ai-proposal
- /admin/overview, /admin/users

Frontend không giả lập kết quả khi backend lỗi. Fixture chỉ được dùng trong tests/ui và không sửa dữ liệu dự án thật.
AI cần cấu hình khóa và dịch vụ ở backend. Chạy mã Python vẫn cần Docker sandbox; không thực thi mã tải lên trên máy chủ API.

## Kiểm tra và chạy

### Bảo vệ thao tác và dữ liệu chưa lưu

- Test đang sửa có nhãn Chưa lưu. Đổi test, đổi dự án hoặc đăng xuất phải xác nhận bỏ nội dung; tải lại/đóng trang sử dụng cảnh báo gốc của trình duyệt. Chuyển tab trong cùng dự án giữ nguyên bản nháp trong bộ nhớ (không lưu mã nháp vào localStorage).
- Chuyển bước đưa vùng nội dung về đầu trang và focus tiêu đề.
- API giới hạn thời gian chờ: mặc định 30 giây; phân tích/sinh nội dung AI và chạy test 180 giây; thu hồi phiên đăng xuất 5 giây. Giới hạn bao gồm cả đọc response body. Caller có thể dùng AbortSignal.
- Dừng chờ chỉ dừng kết nối phía trình duyệt, KHÔNG cam kết hủy tác vụ đang chạy trên backend. Khi kết quả chưa rõ, thao tác sửa bị khóa; chỉ tải lại dữ liệu, không tự gửi lại POST/PATCH. Người dùng phải kiểm tra tác vụ đã hoàn tất/dừng rồi xác nhận mở lại thao tác.
- Nếu backend đã lưu nhưng tải lại thất bại, hiển thị riêng thông báo đó và khóa thao tác sửa đến khi tải lại thành công. Cơ chế áp dụng cả Developer và Admin.
- Đăng xuất xóa phiên trên trình duyệt ngay và gửi thu hồi phiên ở nền. Nếu mất kết nối, token phía máy chủ vẫn còn hiệu lực đến khi hết hạn; không tuyên bố đã thu hồi thành công khi API không phản hồi.
- Thông báo đăng nhập do frontend tạo lưu khóa i18n để đổi ngôn ngữ ngay khi đang hiển thị.

### Thư viện

Nâng Next trong nhánh 15.5 lên 15.5.25; Next hỗ trợ Sharp 0.35.4. Pin override PostCSS 8.5.28 và Sharp 0.35.4 để tránh kéo lại phiên bản bị cảnh báo. Đã bỏ @monaco-editor/react vì không có import sử dụng trong app/lib; bộ hiển thị mã hiện tại vẫn giữ nguyên.

Tham chiếu: [Sharp advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [PostCSS advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849). Kiểm tra lại npm audit khi cài dependency sau này; kết quả 0 cảnh báo không bảo đảm toàn bộ hệ thống không còn lỗ hổng.

Sau npm ci:

    npm run dev
    npm run typecheck
    npm run check:i18n
    npm run test:ui
    npm run test:unit
    npm run build

Backend chạy theo README của backend. Frontend dùng NEXT_PUBLIC_API_BASE_URL.
Playwright mặc định sử dụng Microsoft Edge đã cài trên máy. Trên máy khác có thể cài Chromium bằng npx playwright install chromium và đặt PLAYWRIGHT_CHANNEL=chromium.

Dev dùng .next-dev; production build dùng .next để tránh ghi đè tài nguyên khi hai lệnh chạy cùng lúc. Sau npm run build, dùng npm start cho bản production (cần cổng khác nếu dev còn chạy).

Không coi kiểm thử UI có fixture là bằng chứng Docker hay dịch vụ AI ngoài hệ thống đã chạy thành công.
