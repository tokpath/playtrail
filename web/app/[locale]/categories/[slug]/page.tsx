import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError, getCategory, getGames, getSitemap, getTags } from "@/lib/api/server";
import type { GameCard as GameCardData } from "@/lib/api/types";
import { pageMetadata } from "@/lib/seo";
import { CategoryBanner } from "@/components/game/CategoryBanner";
import { GameCard } from "@/components/game/GameCard";
import { GameFilters } from "@/components/games/GameFilters";
import { ListToolbar } from "@/components/games/ListToolbar";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { RetryButton } from "@/components/layout/RetryButton";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/categories/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "meta.category" });
  let category: Awaited<ReturnType<typeof getCategory>>["category"] | null = null;
  let localesForCategory: string[] = [];
  try {
    const [payload, sitemap] = await Promise.all([getCategory(locale, slug), getSitemap(locale)]);
    category = payload.category;
    localesForCategory = sitemap.categories.find((c) => c.slug === slug)?.locales ?? [];
  } catch {
    // 404 is handled by the page; metadata falls back to the slug.
  }
  const name = category?.name ?? slug;
  return pageMetadata({
    locale,
    liveLocales: localesForCategory,
    path: `/${locale}/categories/${slug}`,
    title: t("title", { category: name }),
    description: t("description", { category: name }),
    // Empty categories are 200 but never indexed (PRD 12.5).
    noindex: (category?.count ?? 1) === 0,
  });
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<"/[locale]/categories/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const t = await getTranslations("list");
  const tHome = await getTranslations("home");
  const tEmpty = await getTranslations("empty");

  let category: Awaited<ReturnType<typeof getCategory>>["category"] | null = null;
  let unknown = false;
  try {
    category = (await getCategory(locale, slug)).category;
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) unknown = true;
  }

  if (unknown) notFound();

  const filters = {
    q: one(query.q)?.trim() || null,
    category: slug,
    tag: one(query.tag) || null,
    sort: one(query.sort) === "newest" ? ("newest" as const) : ("editorial" as const),
  };
  const page = Math.max(1, Number.parseInt(one(query.page) ?? "1", 10) || 1);

  let tags: Awaited<ReturnType<typeof getTags>>["items"] = [];
  let data: Awaited<ReturnType<typeof getGames>> | null = null;
  let bannerGames: GameCardData[] = [];
  let failed = false;
  try {
    const [tagData, gameData, leading] = await Promise.all([
      getTags(locale).then((g) => g.items).catch(() => [] as typeof tags),
      getGames(locale, { ...filters, page }),
      // The banner always shows the category's leading games, whatever the
      // filters; unfiltered this is the same request as the list and dedupes.
      getGames(locale, { q: null, category: slug, tag: null, sort: "editorial", page: 1 })
        .then((g) => g.items)
        .catch(() => [] as GameCardData[]),
    ]);
    tags = tagData;
    data = gameData;
    bannerGames = leading;
  } catch {
    failed = true;
  }

  const hrefWithPage = (targetPage: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.tag) params.set("tag", filters.tag);
    if (filters.sort !== "editorial") params.set("sort", filters.sort);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return `/${locale}/categories/${slug}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
      <CategoryBanner
        slug={slug}
        name={category?.name ?? slug}
        count={category?.count ?? 0}
        games={bannerGames}
      />

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <GameFilters locale={locale} categories={[]} tags={tags} current={filters} showCategory={false} />
        </div>

        <div className="min-w-0 lg:col-span-9">
          <div className="flex flex-wrap items-baseline gap-3">
            <p className="label-mono text-ink-muted">
              {tHome("gamesCount", { count: data?.total ?? category?.count ?? 0 })}
            </p>
          </div>

          <div className="mt-4">
            <ListToolbar locale={locale} current={filters} tags={tags} fixedCategory={slug} />
          </div>

          {data ? (
            data.items.length > 0 ? (
              <>
                <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
                  {data.items.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      entry="category"
                      makeHref={(s) => `/${locale}/games/${s}`}
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
                    <Link
                      href={`/${locale}/categories/${slug}`}
                      className="inline-flex h-11 items-center rounded-input bg-ink px-5 text-[14px] font-medium text-paper"
                    >
                      {t("clearFilters")}
                    </Link>
                  }
                />
              </div>
            )
          ) : (
            <div className="mt-8">
              {failed ? (
                <div className="flex flex-col items-center gap-4 rounded-card border border-hairline bg-surface px-6 py-16 text-center">
                  <p className="text-[15px] text-signal">{tEmpty("errorTitle")}</p>
                  <p className="max-w-[48ch] text-[14px] text-ink-muted">{tEmpty("errorBody")}</p>
                  <RetryButton />
                </div>
              ) : (
                <EmptyState
                  title={tEmpty("noResultsTitle")}
                  body={tEmpty("noResultsBody")}
                  actions={
                    <Link
                      href={`/${locale}/games`}
                      className="inline-flex h-11 items-center rounded-input border border-hairline px-5 text-[14px] text-ink hover:border-ink"
                    >
                      {tEmpty("browseAll")}
                    </Link>
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
