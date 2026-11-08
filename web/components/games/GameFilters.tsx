"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CategoryCount, TagCount } from "@/lib/api/types";
import { categoryColors } from "@/lib/cover";

export type Filters = { q: string | null; category: string | null; tag: string | null; sort: string };

/**
 * Filter rail + mobile drawer for the games list (DESIGN §6.2). All filter
 * state lives in the URL; changing a filter resets to page 1 and can be
 * undone with the browser back button (PRD §05).
 */
export function GameFilters({
  locale,
  categories,
  tags,
  current,
  showCategory = true,
}: {
  locale: string;
  categories: CategoryCount[];
  tags: TagCount[];
  current: Filters;
  showCategory?: boolean;
}) {
  const t = useTranslations("list");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeCount = [current.category, current.tag].filter(Boolean).length + (current.q ? 1 : 0);

  const push = useCallback(
    (patch: Partial<Filters>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("page");
      const query = params.toString();
      router.push(`/${locale}/games${query ? `?${query}` : ""}`, { scroll: false });
    },
    [locale, router, searchParams],
  );

  const clearAll = () => {
    router.push(`/${locale}/games`, { scroll: false });
  };

  const rail = (
    <RailContents
      categories={categories}
      tags={tags}
      current={current}
      showCategory={showCategory}
      onSelect={(patch) => {
        push(patch);
        setDrawerOpen(false);
      }}
      onClear={() => {
        clearAll();
        setDrawerOpen(false);
      }}
    />
  );

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden lg:block">{rail}</aside>

      {/* Mobile trigger */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          className="flex h-11 items-center gap-2 rounded-input border border-hairline bg-surface px-4 text-[14px] text-ink"
        >
          {t("filters")}
          {activeCount > 0 ? (
            <span className="label-mono-sm rounded-full bg-ink px-1.5 py-0.5 text-paper">{activeCount}</span>
          ) : null}
        </button>
      </div>

      {drawerOpen ? <FilterDrawer onClose={() => setDrawerOpen(false)}>{rail}</FilterDrawer> : null}
    </>
  );
}

function RailContents({
  categories,
  tags,
  current,
  showCategory,
  onSelect,
  onClear,
}: {
  categories: CategoryCount[];
  tags: TagCount[];
  current: Filters;
  showCategory: boolean;
  onSelect: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const t = useTranslations("list");
  const hasActive = current.category || current.tag || current.q;

  return (
    <div className="flex h-full flex-col gap-8">
      {showCategory ? (
        <section>
          <h2 className="label-mono mb-3 text-ink-muted">{t("category")}</h2>
          <ul className="space-y-1">
            <li>
              <button
                type="button"
                onClick={() => onSelect({ category: null })}
                className={`flex h-11 w-full items-center justify-between rounded-[10px] px-3 text-[14px] ${
                  !current.category ? "bg-surface-sunk font-medium text-ink" : "text-ink hover:bg-surface-sunk/60"
                }`}
              >
                {t("clearFilters")}
              </button>
            </li>
            {categories.map((category) => {
              const colors = categoryColors(category.slug);
              const selected = current.category === category.slug;
              return (
                <li key={category.slug}>
                  <button
                    type="button"
                    onClick={() => onSelect({ category: selected ? null : category.slug })}
                    aria-pressed={selected}
                    className={`flex h-11 w-full items-center justify-between rounded-[10px] px-3 text-[14px] ${
                      selected ? "bg-ink text-paper" : "text-ink hover:bg-surface-sunk/60"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="inline-block size-2 rounded-full"
                        style={{ background: colors.base }}
                      />
                      {category.name}
                    </span>
                    <span className="label-mono-sm opacity-60">{category.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="label-mono mb-3 text-ink-muted">{t("tag")}</h2>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const selected = current.tag === tag.slug;
            return (
              <button
                key={tag.slug}
                type="button"
                onClick={() => onSelect({ tag: selected ? null : tag.slug })}
                aria-pressed={selected}
                className={`inline-flex h-9 items-center rounded-full px-3 text-[13px] ${
                  selected ? "bg-ink text-paper" : "border border-hairline text-ink hover:border-ink"
                }`}
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-auto">
        {hasActive ? (
          <button
            type="button"
            onClick={onClear}
            className="flex h-11 w-full items-center justify-center rounded-input border border-hairline text-[14px] text-ink hover:border-ink"
          >
            {t("clearAll")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Bottom sheet at 85% height with a focus trap (DESIGN §6.2, PRD 5.1.7). */
function FilterDrawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const t = useTranslations("list");
  const tA11y = useTranslations("a11y");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusables = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])'));
    focusables()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t("filters")}
        className="absolute inset-x-0 bottom-0 flex h-[85dvh] flex-col rounded-t-card border-t border-hairline bg-paper px-5 pb-6 pt-4"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-[20px] font-semibold text-ink">{t("filters")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tA11y("closeFilters")}
            className="flex size-11 items-center justify-center rounded-full text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M4 4 L14 14 M14 4 L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
