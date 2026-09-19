"use client";
import { useEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "../../lib/i18n";

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    let language = "vi";
    try {
      const saved = localStorage.getItem("sentinel.language");
      if (saved === "en" || saved === "vi") language = saved;
    } catch {}
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, []);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
