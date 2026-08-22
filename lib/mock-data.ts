import type { FixProposal, Issue, Project, TestRun } from "./types";

export const project: Project = { id: "prj_001", name: "ShopSafe API", language: "Python 3.12", updatedAt: "2 phút trước", version: "v2" };

export const sourceFiles: Record<string, string> = {
  "app/auth/login.py": `import sqlite3\nfrom fastapi import HTTPException\n\ndef authenticate(username: str, password: str):\n    connection = sqlite3.connect("users.db")\n    cursor = connection.cursor()\n\n    # Xác thực người dùng\n    query = "SELECT * FROM users WHERE username = '" + username + "'"\n    user = cursor.execute(query).fetchone()\n\n    if user is None:\n        raise HTTPException(status_code=401, detail="Sai thông tin đăng nhập")\n\n    return {"id": user[0], "username": user[1]}`,
  "app/services/payment.py": `API_KEY = "sk_live_9f9d1b..."\n\ndef calculate_discount(total, percentage):\n    return total / percentage\n\ndef charge_card(amount, token):\n    try:\n        return gateway.charge(amount, token)\n    except:\n        return None`,
  "app/main.py": `from fastapi import FastAPI\nfrom app.auth.login import authenticate\n\napp = FastAPI(title="ShopSafe API")\n\n@app.get("/health")\ndef health_check():\n    return {"status": "healthy"}`,
  "tests/test_login.py": `from app.auth.login import authenticate\n\ndef test_invalid_account():\n    # Fixture demo: tài khoản không tồn tại\n    assert True`,
};

export const initialIssues: Issue[] = [
  { id: "ISS-001", filePath: "app/auth/login.py", lineStart: 9, lineEnd: 9, ruleCode: "B608", type: "SQL Injection", severity: "CRITICAL", description: "Câu truy vấn SQL được tạo bằng phép nối chuỗi với dữ liệu đầu vào.", confidence: 0.98, status: "PENDING", explanation: "Kẻ tấn công có thể chèn toán tử SQL vào username để vượt qua xác thực hoặc đọc dữ liệu trái phép.", impact: "Ảnh hưởng trực tiếp đến dữ liệu tài khoản và cơ chế đăng nhập." },
  { id: "ISS-002", filePath: "app/services/payment.py", lineStart: 1, lineEnd: 1, ruleCode: "SEC001", type: "Hard-coded Secret", severity: "CRITICAL", description: "Phát hiện API key được viết trực tiếp trong mã nguồn.", confidence: 0.97, status: "PENDING", explanation: "Secret có thể bị lộ qua Git history, log hoặc khi chia sẻ source code.", impact: "Có nguy cơ bị chiếm quyền truy cập cổng thanh toán." },
  { id: "ISS-003", filePath: "app/services/payment.py", lineStart: 4, lineEnd: 4, ruleCode: "B018", type: "Division by Zero", severity: "HIGH", description: "Biến percentage có thể bằng 0 trước khi thực hiện phép chia.", confidence: 0.91, status: "PENDING", explanation: "Đầu vào không được kiểm tra có thể gây ZeroDivisionError và làm gián đoạn request.", impact: "Làm API trả về lỗi 500 cho người dùng." },
  { id: "ISS-004", filePath: "app/services/payment.py", lineStart: 9, lineEnd: 10, ruleCode: "B001", type: "Bare Except", severity: "MEDIUM", description: "Dùng bare except làm che giấu lỗi không mong muốn.", confidence: 0.88, status: "PENDING", explanation: "Toàn bộ exception bị nuốt mà không ghi log hoặc phân loại nguyên nhân.", impact: "Khó điều tra lỗi và có thể trả kết quả sai." },
  { id: "ISS-005", filePath: "app/auth/login.py", lineStart: 5, lineEnd: 5, ruleCode: "RES001", type: "Resource Handling", severity: "LOW", description: "Kết nối SQLite chưa được đóng theo context manager.", confidence: 0.79, status: "VERIFIED", explanation: "Kết nối có thể tồn đọng khi request lỗi hoặc lưu lượng tăng.", impact: "Làm cạn connection resource theo thời gian." },
];

export const proposals: Record<string, FixProposal> = {
  "ISS-001": { issueId: "ISS-001", originalCode: `query = "SELECT * FROM users WHERE username = '" + username + "'"\nuser = cursor.execute(query).fetchone()`, replacementCode: `query = "SELECT * FROM users WHERE username = ?"\nuser = cursor.execute(query, (username,)).fetchone()`, reason: "Dùng parameterized query để SQLite tách dữ liệu username khỏi cú pháp SQL." },
  "ISS-002": { issueId: "ISS-002", originalCode: `API_KEY = "sk_live_9f9d1b..."`, replacementCode: `import os\nAPI_KEY = os.environ["PAYMENT_API_KEY"]`, reason: "Đọc secret từ biến môi trường để không lưu khóa trong repository." },
  "ISS-003": { issueId: "ISS-003", originalCode: `return total / percentage`, replacementCode: `if percentage == 0:\n    raise ValueError("percentage phải khác 0")\nreturn total / percentage`, reason: "Kiểm tra điều kiện biên trước phép chia và trả lỗi có ý nghĩa." },
  "ISS-004": { issueId: "ISS-004", originalCode: `except:\n    return None`, replacementCode: `except PaymentGatewayError as error:\n    logger.warning("Thanh toán thất bại: %s", error)\n    return None`, reason: "Bắt exception cụ thể và ghi log để có thể theo dõi sự cố." },
};

export const testRuns: TestRun[] = [
  { id: "run-22", version: "v2", status: "PASS", total: 20, passed: 20, failed: 0, errors: 0, duration: "2.84s", createdAt: "10:42 · Hôm nay" },
  { id: "run-21", version: "v1", status: "FAIL", total: 20, passed: 14, failed: 5, errors: 1, duration: "2.76s", createdAt: "10:31 · Hôm nay" },
];
