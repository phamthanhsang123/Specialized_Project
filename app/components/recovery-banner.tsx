"use client";
import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";

export default function RecoveryBanner({
  message,
  stale,
  uncertain,
  loading,
  refresh,
  acknowledge,
}: {
  message: string;
  stale: boolean;
  uncertain: boolean;
  loading: boolean;
  refresh: () => void;
  acknowledge: () => void;
}) {
  useTranslation();
  if (!message && !stale && !uncertain) return null;
  return (
    <section className="recovery-banner" role="status">
      <p>
        {uncertain
          ? t(
              "Chưa xác định kết quả thao tác. Dừng chờ không hủy xử lý trên máy chủ. Hãy kiểm tra dữ liệu và tránh gửi lặp.",
            )
          : message ||
            t("Dữ liệu chưa được cập nhật. Các thao tác sửa đang tạm khóa.")}
      </p>
      <div className="inline-actions">
        <button className="outline-button" disabled={loading} onClick={refresh}>
          {t("Tải lại dữ liệu")}
        </button>
        {uncertain && (
          <button
            className="outline-button"
            disabled={loading || stale}
            onClick={() => {
              if (
                window.confirm(
                  t(
                    "Chỉ tiếp tục khi bạn đã kiểm tra kết quả và chắc chắn thao tác trước không còn chạy trên máy chủ. Không gửi lặp một thao tác đã hoàn tất.",
                  ),
                )
              )
                acknowledge();
            }}
          >
            {t("Đã kiểm tra kết quả, mở lại thao tác")}
          </button>
        )}
      </div>
    </section>
  );
}
