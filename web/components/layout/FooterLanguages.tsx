"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { HTML_LANG, LOCALE_NAMES } from "@/lib/i18n/routing";
import { availableLocalesForPath, isGameDetailPath } from "@/lib/i18n/page-locales";

/** Footer language row: plain links to the same page in each live locale,
 * falling back to the target locale's home when it does not exist there
 * (E19, PRD 4.2 §04 step 6). */
export function FooterLanguages({ locale, liveLocales }: { locale: string; liveLocales: string[] }) {
  const t = useTranslations("footer");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const rest = pathname.split("/").slice(2).join("/");
  const query = search.toString();

  // PRD 4.2 §04 step 6 (E19): on a game detail page, a locale the page is not
  // live in sends the visitor to that locale's home instead of a 404/410.
  const switchLocale = (event: MouseEvent, target: string) => {
    if (target === locale) return;
    if (isGameDetailPath(pathname)) {
      const available = availableLocalesForPath(pathname);
      if (available && !available.includes(target)) {
        event.preventDefault();
        router.push(`/${target}`);
      }
    }
  };

  return (
    <div className="text-[14px]">
      <h2 className="label-mono mb-3 text-ink-muted">{t("language")}</h2>
      <ul className="space-y-2.5">
        {(liveLocales.length > 0 ? liveLocales : [locale]).map((l) => (
          <li key={l}>
            <Link
              href={`/${l}${rest ? `/${rest}` : ""}${query ? `?${query}` : ""}`}
              lang={HTML_LANG[l]}
              hrefLang={HTML_LANG[l]}
              onClick={(event) => switchLocale(event, l)}
              className="text-ink underline-offset-4 hover:underline"
            >
              {LOCALE_NAMES[l] ?? l}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
