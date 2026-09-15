# Kết quả đánh giá static

- Thời điểm UTC: `2026-09-15T07:15:09.910045+00:00`
- Phiên bản dữ liệu: `1.0`
- Số mẫu: **20**; số lỗi gán nhãn: **10**
- Mô hình: `không dùng LLM`

| Chỉ số | Giá trị |
|---|---:|
| truePositives | 4 |
| falsePositives | 0 |
| falseNegatives | 6 |
| precision | 1.0 |
| recall | 0.4 |
| f1 | 0.5714 |
| severityAccuracy | 1.0 |
| proposalCount | 3 |
| proposalSyntaxValidRate | 1.0 |

| Loại lỗi | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| BARE_EXCEPT | 1 | 0 | 0 | 1.0 | 1.0 |
| BOUNDARY_LOGIC | 0 | 0 | 1 | N/A | 0.0 |
| COMMAND_INJECTION | 0 | 0 | 1 | N/A | 0.0 |
| DIVISION_BY_ZERO | 1 | 0 | 0 | 1.0 | 1.0 |
| HARDCODED_SECRET | 1 | 0 | 0 | 1.0 | 1.0 |
| INPUT_VALIDATION | 0 | 0 | 1 | N/A | 0.0 |
| NULL_HANDLING | 0 | 0 | 1 | N/A | 0.0 |
| PATH_TRAVERSAL | 0 | 0 | 1 | N/A | 0.0 |
| RESOURCE_LEAK | 0 | 0 | 1 | N/A | 0.0 |
| SQL_INJECTION | 1 | 0 | 0 | 1.0 | 1.0 |

Các giới hạn:
- Bộ dữ liệu nhỏ do nhóm tự gán nhãn, chưa đại diện cho mọi dự án Python.
- Khớp phát hiện theo loại lỗi, tệp và vùng dòng giao nhau.
- Đề xuất đúng cú pháp chưa chứng minh bản sửa đúng hành vi.
