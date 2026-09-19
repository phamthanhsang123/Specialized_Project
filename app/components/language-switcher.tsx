"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../lib/i18n";

export function LanguageSwitcher() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  function selectLanguage(language: "vi" | "en") {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
    try {
      localStorage.setItem("sentinel.language", language);
    } catch {}
  }

  return (
    <label className="language-switcher">
      <span aria-hidden="true">◎</span>
      <span className="sr-only">{t("Ngôn ngữ")}</span>
      <select
        disabled={!ready}
        aria-label={t("Ngôn ngữ")}
        value={i18n.resolvedLanguage === "en" ? "en" : "vi"}
        onChange={(event) =>
          selectLanguage(event.target.value === "en" ? "en" : "vi")
        }
      >
        <option value="vi">Tiếng Việt</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
