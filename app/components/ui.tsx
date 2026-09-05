"use client";
import { t } from "../../lib/i18n";
import { useTranslation } from "react-i18next";
import i18n from "../../lib/i18n";
import type { ReactNode } from "react";
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z",
    code: "m8 9-3 3 3 3m8-6 3 3-3 3M13 5l-2 14",
    spark: "m12 3-1.5 5.5L5 10l5.5 1.5L12 17l1.5-5.5L19 10l-5.5-1.5L12 3z",
    flask: "M9 3h6m-3 0v6l5 8a3 3 0 0 1-2.6 4H9.6A3 3 0 0 1 7 17l5-8",
    clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
    folder:
      "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z",
    upload: "M12 16V4m0 0L8 8m4-4 4 4M5 20h14",
    play: "m8 5 11 7-11 7V5z",
    check: "m5 12 4 4L19 6",
    x: "m6 6 12 12M18 6 6 18",
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
export function dateLabel(value: string): string {
  // Legacy API timestamps are UTC but omit a zone. Match server-side date filters.
  const normalized =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      ? `${value}Z`
      : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(i18n.language === "en" ? "en-GB" : "vi-VN");
}
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
export function SessionGate({
  error,
  retry,
  logout,
}: {
  error: string;
  retry: () => void;
  logout: () => Promise<void>;
}) {
  useTranslation();
  return (
    <main className="session-gate">
      <div className="panel">
        <b>✦ sentinel</b>
        <p role={error ? "alert" : "status"}>
          {error || t("Đang kiểm tra phiên đăng nhập…")}
        </p>
        {error && (
          <div className="inline-actions">
            <button className="primary-button" onClick={retry}>
              {t("Thử lại")}
            </button>
            <button className="outline-button" onClick={() => void logout()}>
              {t("Về đăng nhập")}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}
export function highlightPython(line: string): ReactNode {
  const pattern =
    /(#.*$)|("[^"]*"|'[^']*')|\b(import|from|def|return|if|else|try|except|raise|as|None|True|False|assert|with)\b|(\b\d+\b)/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const offset = match.index!;
    if (offset > cursor) parts.push(line.slice(cursor, offset));
    const className = match[1]
      ? "syntax-comment"
      : match[2]
        ? "syntax-string"
        : match[3]
          ? "syntax-keyword"
          : "syntax-number";
    parts.push(
      <span className={className} key={offset}>
        {match[0]}
      </span>,
    );
    cursor = offset + match[0].length;
  }
  if (cursor < line.length) parts.push(line.slice(cursor));
  return parts.length ? parts : line;
}
