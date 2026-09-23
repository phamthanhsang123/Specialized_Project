"use client";
import { t } from "../../lib/i18n";
import { useTranslation } from "react-i18next";

import { useState } from "react";
import { apiFetch, errorMessage } from "../../lib/api";
export default function TestExplanation({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  useTranslation();
  const [busy, setBusy] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState("");
  async function explain() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{
        explanation: string;
      }>(
        `/projects/${encodeURIComponent(projectId)}/test-runs/${encodeURIComponent(runId)}/explain`,
        {
          method: "POST",
        },
      );
      setExplanation(result.explanation);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="test-explanation">
      <button
        type="button"
        className="run-button"
        disabled={busy}
        onClick={() => void explain()}
      >
        {busy ? t("Đang phân tích log…") : t("Giải thích kết quả bằng AI")}
      </button>
      <small>
        {t("Gửi nội dung cần phân tích tới dịch vụ AI đã cấu hình khi bấm.")}
      </small>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {explanation && <p className="ai-explanation">{explanation}</p>}
    </div>
  );
}
