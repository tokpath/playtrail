import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { ApiError, getCategories, getGames, getLiveLocales, getTags } from "@/lib/api/server";
import { pageMetadata } from "@/lib/seo";
import { GameCard } from "@/components/game/GameCard";
import { GameFilters } from "@/components/games/GameFilters";
import { ListToolbar } from "@/components/games/ListToolbar";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { RetryButton } from "@/components/layout/RetryButton";

export async function generateMetadata({ params }: PageProps<"/[locale]/games">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.games" });
  const liveLocales = await safeLiveLocales();
  return pageMetadata({
    locale,
    liveLocales,
    path: `/${locale}/games`,
    title: t("title"),
    description: t("title"),
    // Search/filter pages are never indexed (PRD 12.5).
    noindex: true,
  });
}

async function safeLiveLocales(): Promise<string[]> {
  try {
    return await getLiveLocales();
  } catch {
    return [];
  }
}

export default async function GamesPage({ params, searchParams }: PageProps<"/[locale]/games">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("list");
  const tEmpty = await getTranslations("empty");

  // Next may deliver repeated params as arrays; we always use the first value.
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const filters = {
    q: one(query.q)?.trim() || null,
    category: one(query.category) || null,
    tag: one(query.tag) || null,
    sort: one(query.sort) === "newest" ? ("newest" as const) : ("editorial" as const),
  };
  const page = Math.max(1, Number.parseInt(one(query.page) ?? "1", 10) || 1);

  let categories: Awaited<ReturnType<typeof getCategories>>["items"] = [];
  let tags: Awaited<ReturnType<typeof getTags>>["items"] = [];
  try {
    [categories, tags] = await Promise.all([getCategories(locale).then((c) => c.items), getTags(locale).then((g) => g.items)]);
  } catch {
    // Filters render empty; the list itself reports its own state below.
  }

  let data: Awaited<ReturnType<typeof getGames>> | null = null;
  let badRequest = false;
  try {
    data = await getGames(locale, { ...filters, page });
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) badRequest = true;
    else data = null;
  }

  const hrefWithPage = (targetPage: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.category) params.set("category", filters.category);
    if (filters.tag) params.set("tag", filters.tag);
    if (filters.sort !== "editorial") params.set("sort", filters.sort);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return `/${locale}/games${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-[36px] font-bold tracking-tight text-ink">{t("title")}</h1>
        {data ? <span className="label-mono text-ink-muted">{t("resultCount", { count: data.total })}</span> : null}
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <GameFilters locale={locale} categories={categories} tags={tags} current={filters} />
        </div>

        <div className="min-w-0 lg:col-span-9">
          <ListToolbar locale={locale} current={filters} categories={categories} tags={tags} />

          {data ? (
            data.items.length > 0 ? (
              <>
                <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
                  {data.items.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      entry={filters.q ? "search" : filters.category ? "category" : "direct_or_unknown"}
                      makeHref={(slug) => `/${locale}/games/${slug}`}
                    />
                  ))}
                </div>
                <Pagination page={data.page} totalPages={data.totalPages} makeHref={hrefWithPage} />
              </>
            ) : (
              <div className="mt-8">
                <EmptyState
                  title={tEmpty("noResultsTitle")}
                  body={tEmpty("noResultsBody")}
                  actions={
                    <>
                      <ClearFiltersLink locale={locale} label={t("clearFilters")} />
                      <Link
                        href={`/${locale}`}
                        className="inline-flex h-11 items-center rounded-input border border-hairline px-5 text-[14px] text-ink hover:border-ink"
                      >
                        {tEmpty("backHome")}
                      </Link>
                    </>
                  }
                />
              </div>
            )
          ) : (
            <div className="mt-8">
              <div className="flex flex-col items-center gap-4 rounded-card border border-hairline bg-surface px-6 py-16 text-center">
                <p className="text-[15px] text-signal">
                  {badRequest ? tEmpty("noResultsTitle") : tEmpty("errorTitle")}
                </p>
                {badRequest ? (
                  <ClearFiltersLink locale={locale} label={t("clearFilters")} />
                ) : (
                  <>
                    <p className="max-w-[48ch] text-[14px] text-ink-muted">{tEmpty("errorBody")}</p>
                    <RetryButton />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClearFiltersLink({ locale, label }: { locale: string; label: string }) {
  return (
    <Link
      href={`/${locale}/games`}
      className="inline-flex h-11 items-center rounded-input bg-ink px-5 text-[14px] font-medium text-paper"
    >
      {label}
    </Link>
  );
}
