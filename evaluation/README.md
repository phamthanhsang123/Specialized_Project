# Đánh giá khả năng phát hiện lỗi

Bộ dữ liệu phiên bản 1.0 có 20 mẫu Python: 10 mẫu chứa lỗi đã gán nhãn và 10 mẫu đối chứng an toàn. Các nhóm lỗi gồm SQL Injection, khóa bí mật viết trực tiếp, chia cho 0, bắt ngoại lệ quá rộng, thiếu kiểm tra đầu vào, xử lý giá trị rỗng, rò rỉ tài nguyên, chèn lệnh, duyệt đường dẫn và lỗi điều kiện biên.

Chạy đường cơ sở bằng bộ phân tích tĩnh:

```powershell
backend\.venv\Scripts\python.exe evaluation\evaluate.py --mode static --output-prefix evaluation\results\static-baseline
```

Để đánh giá LLM thật, cấu hình khóa của Gemini, OpenAI hoặc Grok trong `backend/.env`, sau đó chạy:

```powershell
backend\.venv\Scripts\python.exe evaluation\evaluate.py --mode ai --provider gemini
```

Giá trị `--provider` nhận `gemini`, `openai` hoặc `grok`. Nếu bỏ qua, công cụ dùng `AI_DEFAULT_PROVIDER`.

Mỗi mẫu được gửi riêng bằng đúng prompt và schema của chức năng quét AI trong website. Kết quả JSON giữ chi tiết từng dự đoán; báo cáo Markdown tổng hợp TP, FP, FN, Precision, Recall, F1, độ chính xác mức độ lỗi và tỉ lệ đề xuất biên dịch được.

Không đưa khóa API vào Git. Mã nguồn trong bộ dữ liệu sẽ được gửi tới dịch vụ AI đã cấu hình khi chạy `--mode ai`. Bộ dữ liệu nhỏ này chỉ là đường cơ sở cho đồ án; cần mở rộng và có ít nhất hai thành viên kiểm tra nhãn trước khi dùng số liệu trong báo cáo cuối.
