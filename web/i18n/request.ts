import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n/routing";

import en from "../messages/en.json";
import zh from "../messages/zh.json";

// Message catalogs for the configured locales; a locale without a catalog
// falls back to English.
const CATALOGS: Record<string, typeof en> = { en, zh };

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && LOCALES.includes(requested) ? requested : DEFAULT_LOCALE;
  return { locale, messages: CATALOGS[locale] ?? en };
});
