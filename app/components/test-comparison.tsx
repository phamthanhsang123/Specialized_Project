"use client";
import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";
import type { TestRun } from "../../lib/types";
import { dateLabel } from "./ui";

export default function TestComparison({ runs }: { runs: TestRun[] }) {
  useTranslation();
  if (runs.length < 2) return null;
  // API returns newest first. Counts alone cannot establish a regression.
  return (
    <section
      className="test-comparison"
      aria-label={t("So sánh hai lượt gần nhất")}
    >
      <h3>{t("So sánh hai lượt gần nhất")}</h3>
      <div className="comparison-cards">
        {[runs[1], runs[0]].map((run, index) => (
          <article key={run.id}>
            <span>{index === 0 ? t("Lượt trước") : t("Gần nhất")}</span>
            <b>
              {run.version} · {t(run.status)}
            </b>
            <p>
              {t(
                "{{passed}}/{{total}} đạt · {{failed}} lỗi · {{errors}} lỗi thực thi",
                {
                  passed: run.passed,
                  total: run.total,
                  failed: run.failed,
                  errors: run.errors,
                },
              )}
            </p>
            <small>
              {dateLabel(run.createdAt)} · {run.duration}
            </small>
          </article>
        ))}
      </div>
      <p className="form-help">
        {t(
          "Chỉ đối chiếu khi dùng cùng bộ test. Chênh lệch số lượng chưa đủ để kết luận có lỗi hồi quy.",
        )}
      </p>
    </section>
  );
}
