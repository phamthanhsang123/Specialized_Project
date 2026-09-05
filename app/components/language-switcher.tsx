"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../lib/i18n";

export function LanguageSwitcher() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <label className="language-switcher">
      <span aria-hidden="true">◎</span>
      <span className="sr-only">{t("Ngôn ngữ")}</span>
      <select
        disabled={!ready}
        aria-label={t("Ngôn ngữ")}
        value={i18n.language}
        onChange={(event) => {
          void i18n.changeLanguage(event.target.value);
        }}
      >
        <option value="vi">Tiếng Việt</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
