"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Filters } from "./GameFilters";

/**
 * List toolbar: search box + sort segmented control + active filter chips
 * (DESIGN §6.2). State lives in the URL.
 */
export function ListToolbar({ locale, current }: { locale: string; current: Filters }) {
  const t = useTranslations("list");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();

  const push = (patch: Partial<Filters>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    const query = params.toString();
    router.push(`/${locale}/games${query ? `?${query}` : ""}`, { scroll: false });
  };

  const removeParam = (key: string) => push({ [key]: null } as Partial<Filters>);
  const chips: { key: string; label: string }[] = [];
  if (current.q) chips.push({ key: "q", label: `“${current.q}”` });
  if (current.category) chips.push({ key: "category", label: current.category });
  if (current.tag) chips.push({ key: "tag", label: current.tag });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <form action={`/${locale}/games`} role="search" className="min-w-0 flex-1 sm:max-w-[420px]">
          <input
            type="search"
            name="q"
            defaultValue={current.q ?? ""}
            maxLength={80}
            placeholder={t("searchPlaceholder")}
            className="h-11 w-full rounded-input bg-surface-sunk px-4 text-[14px] text-ink placeholder:text-ink-muted"
          />
          <button type="submit" className="sr-only">
            {tA11y("searchSubmit")}
          </button>
        </form>
        <SegmentedSort sort={current.sort} onChange={(sort) => push({ sort })} />
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mono-sm text-ink-muted">{t("activeFilters")}</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => removeParam(chip.key)}
              aria-label={tA11y("clearFilter", { label: chip.label })}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3 text-[13px] text-paper"
            >
              {chip.label}
              <span aria-hidden="true" className="text-[12px] opacity-70">
                ×
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => router.push(`/${locale}/games`, { scroll: false })}
            className="label-mono-sm h-9 px-2 text-ink-muted underline-offset-4 hover:text-ink hover:underline"
          >
            {t("clearAll")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Two-option segmented control (DESIGN §4.4). */
function SegmentedSort({ sort, onChange }: { sort: string; onChange: (sort: string) => void }) {
  const t = useTranslations("list");
  const options: { value: string; label: string }[] = [
    { value: "editorial", label: t("sortEditorial") },
    { value: "newest", label: t("sortNewest") },
  ];
  return (
    <div role="group" className="flex h-11 items-center rounded-input bg-surface-sunk p-1">
      {options.map((option) => {
        const selected = (sort || "editorial") === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={`h-9 rounded-[9px] px-3.5 text-[13px] transition-colors ${
              selected ? "bg-surface text-ink shadow-none ring-1 ring-hairline" : "text-ink-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
