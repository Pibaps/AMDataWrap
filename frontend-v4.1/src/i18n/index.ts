import { useCallback } from "react";
import { useV4Store } from "../store/useV4Store";
import { en } from "./en";
import { fr, type TranslationKey } from "./fr";

export type Locale = "fr" | "en";
export type { TranslationKey };

const DICTS: Record<Locale, Record<TranslationKey, string>> = { fr, en };

export function translate(locale: Locale, key: TranslationKey): string {
  return DICTS[locale]?.[key] ?? fr[key] ?? key;
}

export function useT(): { t: (key: TranslationKey) => string; locale: Locale } {
  const locale = useV4Store((s) => s.locale);
  const t = useCallback((key: TranslationKey) => translate(locale, key), [locale]);
  return { t, locale };
}
