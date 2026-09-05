"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { t } from "../../lib/i18n";

// Preserve the message key and interpolation values so active notices also
// update when the user changes language.
export function useMessage() {
  useTranslation();
  const [message, setMessage] = useState<{
    key: string;
    values?: Record<string, unknown>;
  }>({ key: "" });
  return [
    message.key ? t(message.key, message.values) : "",
    (key: string, values?: Record<string, unknown>) =>
      setMessage({ key, values }),
  ] as const;
}
