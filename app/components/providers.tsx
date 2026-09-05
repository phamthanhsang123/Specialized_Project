"use client";
import { useEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "../../lib/i18n";

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sentinel.language");
      if (saved === "vi" || saved === "en") void i18n.changeLanguage(saved);
    } catch {}
    const changed = (language: string) => {
      document.documentElement.lang = language;
      try {
        localStorage.setItem("sentinel.language", language);
      } catch {}
    };
    changed(i18n.language);
    i18n.on("languageChanged", changed);
    return () => {
      i18n.off("languageChanged", changed);
    };
  }, []);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
