"use client";

import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { CategoryCount } from "@/lib/api/types";
import { categoryColors } from "@/lib/cover";
import { availableLocalesForPath, isGameDetailPath } from "@/lib/i18n/page-locales";
import { HTML_LANG, LOCALE_NAMES } from "@/lib/i18n/routing";

/** Logo mark: two route nodes joined by a dashed segment (DESIGN §4.1). */
export function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 14 C 6 8, 10 12, 15 4" fill="none" stroke="var(--trail)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 5" />
      <circle cx="3" cy="14" r="2.6" fill="var(--ink)" />
      <circle cx="15" cy="4" r="2.6" fill="var(--trail)" />
    </svg>
  );
}

export function Header({
  locale,
  categories,
  liveLocales,
}: {
  locale: string;
  categories: CategoryCount[];
  liveLocales: string[];
}) {
  const t = useTranslations("header");
  const tA11y = useTranslations("a11y");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const inCategory = pathname.startsWith(`/${locale}/categories/`);
  const currentCategory = inCategory ? pathname.split("/")[3] : null;
  const onGames = pathname === `/${locale}/games`;

  return (
    <header
      className={`sticky top-0 z-40 border-b border-hairline bg-paper transition-[background-color,backdrop-filter] ${
        scrolled ? "bg-paper/90 backdrop-blur-md backdrop-saturate-[1.2]" : ""
      }`}
    >
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
        <Link href={`/${locale}`} className="flex items-center gap-2.5" aria-label="PlayTrail">
          <LogoMark />
          <span className="font-display text-[19px] font-bold tracking-tight text-ink">PlayTrail</span>
          {locale === "zh" ? <span className="text-[14px] text-ink-muted">游引</span> : null}
        </Link>

        {/* Search: full box ≥1024, icon on smaller screens */}
        <form action={`/${locale}/games`} className="ml-auto hidden h-10 w-full max-w-[420px] lg:block" role="search">
          <label className="relative flex h-10 items-center rounded-input bg-surface-sunk px-3">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-ink-muted">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              name="q"
              defaultValue={inCategory ? "" : (searchParams.get("q") ?? "")}
              placeholder={t("searchPlaceholder")}
              maxLength={80}
              className="h-full w-full bg-transparent px-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:outline-none"
            />
            <kbd aria-hidden="true" className="label-mono-sm hidden rounded border border-hairline px-1.5 py-0.5 text-ink-muted xl:block">
              ↵
            </kbd>
            <button type="submit" className="sr-only">
              {tA11y("searchSubmit")}
            </button>
          </label>
        </form>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label={tA11y("searchSubmit")}
          className="ml-auto flex size-11 items-center justify-center rounded-full text-ink lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <LanguageSwitcher locale={locale} liveLocales={liveLocales} />
      </div>

      {/* Category trail signs: horizontally scrollable at every width (DESIGN §4.1) */}
      {categories.length > 0 ? (
        <nav aria-label={t("categoriesLabel")} className="border-t border-hairline/60">
          <div className="mx-auto flex max-w-[1240px] items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6">
            <Link
              href={`/${locale}/games`}
              aria-current={onGames && !currentCategory ? "page" : undefined}
              className={`label-mono-sm flex h-8 shrink-0 items-center rounded-full px-3 transition-colors ${
                onGames && !currentCategory ? "bg-ink text-paper" : "text-ink-muted hover:text-ink"
              }`}
            >
              {t("allGames")}
            </Link>
            {categories.map((category) => {
              const colors = categoryColors(category.slug);
              const current = category.slug === currentCategory;
              return (
                <Link
                  key={category.slug}
                  href={`/${locale}/categories/${category.slug}`}
                  aria-current={current ? "page" : undefined}
                  className={`label-mono-sm flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 transition-colors ${
                    current ? "border-ink bg-ink text-paper" : "border-hairline text-ink hover:border-ink"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 rounded-full"
                    style={{ background: colors.base }}
                  />
                  {category.name}
                  <span aria-hidden="true" className="opacity-60">
                    {category.count}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}

      {/* Mobile expanded search */}
      {searchOpen ? (
        <div className="fixed inset-0 z-50 bg-paper/95 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true">
          <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 pt-4">
            <form action={`/${locale}/games`} className="h-12 flex-1" role="search" onSubmit={() => setSearchOpen(false)}>
              <input
                type="search"
                name="q"
                autoFocus
                maxLength={80}
                placeholder={t("searchPlaceholder")}
                className="h-12 w-full rounded-input bg-surface-sunk px-4 text-[16px] text-ink placeholder:text-ink-muted"
              />
              <button type="submit" className="sr-only">
                {tA11y("searchSubmit")}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              aria-label={tA11y("close")}
              className="flex size-11 items-center justify-center rounded-full text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M4 4 L14 14 M14 4 L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function LanguageSwitcher({ locale, liveLocales }: { locale: string; liveLocales: string[] }) {
  const tA11y = useTranslations("a11y");
  const tFooter = useTranslations("footer");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const rest = pathname.split("/").slice(2).join("/");
  const query = search.toString();
  const hrefFor = (target: string) => `/${target}${rest ? `/${rest}` : ""}${query ? `?${query}` : ""}`;

  // The switcher lists live locales (PRD 05); keep the current locale listed
  // even when it is below the live threshold, so the visitor can stay.
  const locales = liveLocales.includes(locale) ? liveLocales : [locale, ...liveLocales];

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest("[data-lang-switcher]")) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" data-lang-switcher>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={tA11y("languageSwitcher")}
        className="flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:text-ink-muted"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="9" cy="9" r="7" />
          <ellipse cx="9" cy="9" rx="3" ry="7" />
          <line x1="2" y1="9" x2="16" y2="9" />
        </svg>
        <span className="ml-1.5 hidden whitespace-nowrap text-[14px] lg:inline">{LOCALE_NAMES[locale]}</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute right-0 top-12 z-50 w-44 overflow-hidden rounded-card border border-hairline bg-surface py-1.5 shadow-lg"
        >
          <li className="label-mono-sm px-3.5 py-1.5 text-ink-muted">{tFooter("language")}</li>
          {locales.map((l) => (
            <li key={l} role="option" aria-selected={l === locale}>
              <Link
                href={hrefFor(l)}
                onClick={(event) => {
                  setOpen(false);
                  // PRD 4.2 §04 step 6 (E19): when the target locale does not
                  // have the current page, go to that locale's home instead.
                  if (l !== locale && isGameDetailPath(pathname)) {
                    const available = availableLocalesForPath(pathname);
                    if (available && !available.includes(l)) {
                      event.preventDefault();
                      router.push(`/${l}`);
                    }
                  }
                }}
                lang={HTML_LANG[l]}
                className="flex h-10 items-center justify-between px-3.5 text-[15px] text-ink hover:bg-surface-sunk"
              >
                {LOCALE_NAMES[l]}
                {l === locale ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2 7.5 L5.5 11 L12 3.5" fill="none" stroke="var(--trail)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
