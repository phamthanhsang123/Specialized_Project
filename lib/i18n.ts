import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import vi from "../locales/vi.json";

// Source copy is the key. No source code, filenames or server findings are translated.
if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources: { vi: { translation: vi } },
    lng: "vi",
    fallbackLng: "vi",
    supportedLngs: ["vi"],
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    initAsync: false,
  });
}
export const t = (key: string, values?: Record<string, unknown>): string =>
  String(i18next.t(key, values ?? {}));
export default i18next;
