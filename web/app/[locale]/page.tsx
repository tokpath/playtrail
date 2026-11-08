import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { formatDate } from "@/lib/i18n/format";
import { getHome, getLiveLocales } from "@/lib/api/server";
import { pageMetadata } from "@/lib/seo";
import { GameCard } from "@/components/game/GameCard";
import { GameCover } from "@/components/game/GameCover";
import { TrailCover } from "@/components/game/TrailCover";
import { StopMarker } from "@/components/ui/StopMarker";
import { TrailLine } from "@/components/ui/TrailLine";
import { ScrollRow } from "@/components/ui/ScrollRow";
import { TicketStub } from "@/components/ui/TicketStub";
import { RetryButton } from "@/components/layout/RetryButton";

export async function generateMetadata({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.home" });
  const liveLocales = await safeLiveLocales();
  return pageMetadata({
    locale,
    liveLocales,
    path: `/${locale}`,
    title: t("title"),
    description: t("description"),
  });
}

async function safeLiveLocales(): Promise<string[]> {
  try {
    return await getLiveLocales();
  } catch {
    return [];
  }
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tFmt = await getTranslations("home");

  let data: Awaited<ReturnType<typeof getHome>> | null = null;
  try {
    data = await getHome(locale);
  } catch {
    data = null;
  }

  if (!data) {
    const tEmpty = await getTranslations("empty");
    return (
      <div className="mx-auto max-w-[720px] px-4 py-24 sm:px-6">
        <div className="flex flex-col items-center gap-4 rounded-card border border-hairline bg-surface px-6 py-16 text-center">
          <p className="text-[15px] text-signal">{tEmpty("errorTitle")}</p>
          <p className="max-w-[48ch] text-[14px] text-ink-muted">{tEmpty("errorBody")}</p>
          <RetryButton />
        </div>
      </div>
    );
  }

  const featured = data.featured;
  const [lead, ...rest] = featured;
  const railStops = rest.slice(0, 4);
  const gridStops = rest.slice(4);

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      {/* §6.1.1 Opening section */}
      <section className="grid gap-12 py-14 lg:grid-cols-12 lg:py-16">
        <div className="lg:col-span-7">
          <p className="label-mono text-ink-muted">{t("eyebrow")}</p>
          <h1 className="mt-4 max-w-[16ch] font-display text-[clamp(40px,6vw,72px)] font-bold leading-[1.02] tracking-[-0.03em] text-ink">
            {t("title")}
          </h1>
          <p className="mt-5 max-w-[52ch] text-[18px] leading-relaxed text-ink-muted">{t("subtitle")}</p>
          <form action={`/${locale}/games`} role="search" className="mt-8 max-w-[520px]">
            <div className="flex h-14 items-center rounded-input bg-surface-sunk px-4">
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0 text-ink-muted">
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                name="q"
                maxLength={80}
                placeholder={t("searchPlaceholder")}
                className="h-full w-full bg-transparent px-3 text-[16px] text-ink placeholder:text-ink-muted focus:outline-none"
              />
              <button type="submit" className="sr-only">
                {t("searchPlaceholder")}
              </button>
            </div>
          </form>
        </div>

        {/* Trail collage: five latest picks strung on a dashed trail (desktop) */}
        {featured.length > 0 ? (
          <div className="hidden lg:col-span-5 lg:flex lg:items-center" aria-hidden="true">
            <TrailCollage games={featured.slice(0, 5)} />
          </div>
        ) : null}
      </section>

      {/* Stats line: real numbers only (DESIGN §6.1.1) */}
      <p className="label-mono -mt-8 pb-4 text-ink-muted lg:-mt-4">
        {tFmt("statsGames", { count: data.totalGames })}
        <span aria-hidden="true"> · </span>
        {tFmt("statsCategories", { count: data.categories.length })}
        {data.updatedAt ? (
          <>
            <span aria-hidden="true"> · </span>
            {tFmt("statsUpdated", { date: formatDate(data.updatedAt, locale) })}
          </>
        ) : null}
      </p>

      {/* §6.1.2 Today's trail */}
      {featured.length > 0 ? (
        <section className="border-t border-hairline py-16">
          <div className="flex items-center gap-3">
            <StopMarker n={1} />
            <h2 className="font-display text-[28px] font-semibold tracking-tight text-ink">{t("todayTrail")}</h2>
          </div>
          <div className="mt-8 grid gap-8 lg:grid-cols-12">
            {lead ? (
              <div className="lg:col-span-7">
                <GameCard game={lead} variant="lg" entry="home_featured" makeHref={makeGameHref(locale)} priority />
              </div>
            ) : null}
            {railStops.length > 0 ? (
              <div className="lg:col-span-5">
                <TrailRail games={railStops} locale={locale} />
              </div>
            ) : null}
          </div>
          {gridStops.length > 0 ? (
            <div className="mt-12 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-4">
              {gridStops.map((game) => (
                <GameCard key={game.id} game={game} entry="home_featured" makeHref={makeGameHref(locale)} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* §6.1.3 CrazyGames hot snapshot */}
      {data.hot ? (
        <section className="border-t border-hairline py-16">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-[28px] font-semibold tracking-tight text-ink">{t("hotSnapshot")}</h2>
            <Link
              href={`/${locale}/hot`}
              className="label-mono-sm inline-flex h-11 items-center gap-1.5 text-trail hover:underline"
            >
              {t("hotViewAll")} <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="mt-4">
            <TicketStub
              fetchedAt={data.hot.sourceFetchedAt}
              region={data.hot.observedRegion}
              stale={data.hot.stale}
            />
          </div>
          <ScrollRow className="mt-8 flex gap-8 pb-4 pl-5">
            {data.hot.items.map((item) => (
              <div key={item.position} className="relative w-[280px] shrink-0">
                <span
                  aria-hidden="true"
                  className="text-outline pointer-events-none absolute top-1/2 left-0 z-10 -translate-x-[70%] -translate-y-1/2 font-display text-[64px] font-extrabold leading-none"
                >
                  {item.position}
                </span>
                <GameCard game={item.game} entry="home_hot" makeHref={makeGameHref(locale)} />
              </div>
            ))}
          </ScrollRow>
        </section>
      ) : null}

      {/* §6.1.4 Browse by category */}
      {data.categories.length > 0 ? (
        <section className="border-t border-hairline py-16">
          <h2 className="font-display text-[28px] font-semibold tracking-tight text-ink">{t("browseByCategory")}</h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {data.categories.map((category) => (
              <Link
                key={category.slug}
                href={`/${locale}/categories/${category.slug}`}
                className="card-hover group relative block aspect-[16/7] overflow-hidden rounded-card border border-hairline"
              >
                <TrailCover slug={category.slug} category={category.slug} name={category.name} banner />
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/40 to-transparent p-4">
                  <span className="font-display text-[22px] font-semibold tracking-tight text-[#F5F1E8]">
                    {category.name}
                  </span>
                  <span className="label-mono text-[#F5F1E8]/85">{category.count}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function makeGameHref(locale: string) {
  return (slug: string) => `/${locale}/games/${slug}`;
}

/** §6.1.1 collage: five covers strung along a dashed trail with stop numbers.
 * Covers sit on a fixed zigzag; the trail passes through their centers. */
function TrailCollage({ games }: { games: Awaited<ReturnType<typeof getHome>>["featured"] }) {
  const stops = [
    { x: 66, y: 46 },
    { x: 292, y: 126 },
    { x: 84, y: 208 },
    { x: 284, y: 288 },
    { x: 116, y: 364 },
  ];
  const path = stops
    .map((s, i) => {
      if (i === 0) return `M ${s.x} ${s.y}`;
      const prev = stops[i - 1];
      const cx = (prev.x + s.x) / 2 + (i % 2 === 0 ? -24 : 24);
      const cy = (prev.y + s.y) / 2;
      return `S ${cx} ${cy}, ${s.x} ${s.y}`;
    })
    .join(" ");

  return (
    <div className="relative mx-auto h-[400px] w-[420px]" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 440">
        <path d={path} fill="none" stroke="var(--trail)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 7" />
      </svg>
      {games.slice(0, 5).map((game, i) => {
        const stop = stops[i];
        return (
          <div
            key={game.id}
            className="absolute flex items-center gap-2.5"
            style={{ left: stop.x - 60, top: stop.y - 34 }}
          >
            <span className="block h-[68px] w-[120px] overflow-hidden rounded-[10px] border border-hairline">
              <GameCover cover={game.cover} slug={game.slug} category={game.primaryCategory.slug} name={game.name} alt="" />
            </span>
            <StopMarker n={i + 1} size={24} />
          </div>
        );
      })}
    </div>
  );
}

/** §6.1.2 rail: stops 2–5 with a vertical trail on the left. */
function TrailRail({
  games,
  locale,
}: {
  games: Awaited<ReturnType<typeof getHome>>["featured"];
  locale: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center pt-1" aria-hidden="true">
        <TrailLine vertical length={games.length * 116} />
      </div>
      <ol className="flex flex-1 flex-col gap-7">
        {games.map((game, i) => (
          <li key={game.id} className="flex items-start gap-3">
            <span className="mt-0.5">
              <StopMarker n={i + 2} size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <GameCard game={game} variant="row" entry="home_featured" makeHref={makeGameHref(locale)} />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
