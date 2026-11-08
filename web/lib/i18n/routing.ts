export const LOCALES = (process.env.SUPPORTED_LOCALES ?? "en,zh")
  .split(",")
  .map((l) => l.trim())
  .filter(Boolean) as string[];

export const DEFAULT_LOCALE = process.env.DEFAULT_LOCALE ?? "en";

export function isLocale(value: string | undefined | null): value is string {
  return value != null && LOCALES.includes(value);
}

/** `<html lang>` / hreflang value per PRD 17.2; route prefix is the plain locale. */
export const HTML_LANG: Record<string, string> = {
  en: "en",
  zh: "zh-Hans",
};

export function htmlLang(locale: string): string {
  return HTML_LANG[locale] ?? locale;
}

/** Locale display names in their own language (self-exonyms for the switcher). */
export const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  zh: "简体中文",
};

/** Open Graph locale tags per PRD 20.2. */
export const OG_LOCALE: Record<string, string> = {
  en: "en_US",
  zh: "zh_CN",
};

export function ogLocale(locale: string): string {
  return OG_LOCALE[locale] ?? locale.replace("-", "_");
}
