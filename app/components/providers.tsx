"use client";
import { useEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "../../lib/i18n";

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    void i18n.changeLanguage("vi");
    document.documentElement.lang = "vi";
    try {
      localStorage.setItem("sentinel.language", "vi");
    } catch {}
  }, []);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
