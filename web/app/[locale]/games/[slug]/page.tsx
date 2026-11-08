import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError, getGame, getLiveLocales } from "@/lib/api/server";
import type { GameDetail } from "@/lib/api/types";
import { pageMetadata } from "@/lib/seo";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { categoryColors } from "@/lib/cover";
import { GameCover } from "@/components/game/GameCover";
import { GameCard } from "@/components/game/GameCard";
import { OutboundCTA, StickyCTA } from "@/components/detail/OutboundCTA";
import { GameViewTracker } from "@/components/detail/GameViewTracker";
import { FieldNotes } from "@/components/ui/FieldNotes";
import { TagChip } from "@/components/ui/Chip";
import { Kbd } from "@/components/ui/Kbd";
import { TrailLine } from "@/components/ui/TrailLine";
import { EmptyState } from "@/components/ui/EmptyState";
import { RetryButton } from "@/components/layout/RetryButton";
import { ScrollRow } from "@/components/ui/ScrollRow";
import { TrackedLink } from "@/components/layout/TrackedLink";

export async function generateMetadata({ params }: PageProps<"/[locale]/games/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "meta.game" });
  let game: GameDetail | null = null;
  try {
    game = await getGame(locale, slug);
  } catch {
    // Rendered page handles the failure; metadata falls back to the slug.
  }
  const liveLocales = await safeLiveLocales();
  return pageMetadata({
    locale,
    // hreflang lists the locales this game is actually live in (PRD 12.6).
    liveLocales: game ? game.availableLocales.filter((l) => liveLocales.includes(l)) : liveLocales,
    path: `/${locale}/games/${slug}`,
    title: t("title", { name: game?.name ?? slug }),
    description: game?.summary ?? "",
    // Authorized cover → its 1200×630 share URL; otherwise the generated
    // per-game opengraph-image applies (PRD 20.2, E23).
    ogImage: game?.cover ? game.cover.shareUrl : `/${locale}/games/${slug}/opengraph-image`,
  });
}

async function safeLiveLocales(): Promise<string[]> {
  try {
    return await getLiveLocales();
  } catch {
    return [];
  }
}

export default async function GameDetailPage({ params }: PageProps<"/[locale]/games/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("detail");
  const tFields = await getTranslations("detail.fields");
  const tEmpty = await getTranslations("empty");

  let game: GameDetail | null = null;
  let gone = false;
  let failed = false;
  try {
    game = await getGame(locale, slug);
  } catch (error) {
    if (error instanceof ApiError && error.isGone) gone = true;
    else if (!(error instanceof ApiError && error.isNotFound)) failed = true;
  }

  if (gone) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6">
        <EmptyState
          title={tEmpty("goneTitle")}
          body={tEmpty("goneBody")}
          actions={
            <Link
              href={`/${locale}/games`}
              className="inline-flex h-11 items-center rounded-input border border-hairline px-5 text-[14px] text-ink hover:border-ink"
            >
              {t("backToList")}
            </Link>
          }
        />
      </div>
    );
  }

  if (!game) {
    if (failed) {
      return (
        <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6">
          <div className="flex flex-col items-center gap-4 rounded-card border border-hairline bg-surface px-6 py-16 text-center">
            <p className="text-[15px] text-signal">{tEmpty("errorTitle")}</p>
            <p className="max-w-[48ch] text-[14px] text-ink-muted">{tEmpty("errorBody")}</p>
            <RetryButton />
          </div>
        </div>
      );
    }
    notFound();
  }

  const categoryHref = `/${locale}/categories/${game.primaryCategory.slug}`;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6">
      <GameViewTracker gameId={game.id} locale={locale} availableLocales={game.availableLocales} />

      {/* Breadcrumb (DESIGN §6.3) */}
      <nav aria-label="Breadcrumb" className="label-mono flex flex-wrap items-center gap-2 text-ink-muted">
        <Link href={`/${locale}`} className="hover:text-ink">
          {t("breadcrumbHome")}
        </Link>
        <span aria-hidden="true">›</span>
        <Link href={categoryHref} className="hover:text-ink">
          {game.primaryCategory.name}
        </Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="text-ink">
          {game.name}
        </span>
      </nav>

      {/* Upper: cover + identity */}
      <div className="mt-6 grid gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="min-w-0 lg:col-span-7">
          <GameCover
            cover={game.cover}
            slug={game.slug}
            category={game.primaryCategory.slug}
            name={game.name}
            priority
            className="aspect-[16/9]"
          />
          {game.screenshots.length > 0 ? (
            <div className="mt-4">
              <h2 className="label-mono text-ink-muted">{t("screenshots")}</h2>
              <ScrollRow className="mt-3 flex gap-3 pb-2">
                {game.screenshots.map((shot, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={shot.url}
                    src={shot.url}
                    srcSet={shot.srcset.map((s) => `${s.url} ${s.width}w`).join(", ")}
                    alt={shot.alt || `${game.name} ${i + 1}`}
                    width={shot.width}
                    height={shot.height}
                    loading="lazy"
                    decoding="async"
                    className="h-[180px] w-auto rounded-cover border border-hairline object-cover"
                  />
                ))}
              </ScrollRow>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 lg:col-span-5">
          <TrackedLink href={categoryHref} entry="category" className="inline-flex">
            <span className="label-mono-sm inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-ink hover:border-ink">
              <span
                aria-hidden="true"
                className="inline-block size-2 rounded-full"
                style={{ background: categoryColors(game.primaryCategory.slug).base }}
              />
              {game.primaryCategory.name}
            </span>
          </TrackedLink>
          <h1 className="mt-3 font-display text-[40px] font-bold leading-[1.06] tracking-[-0.02em] text-ink lg:text-[48px]">
            {game.name}
          </h1>
          {game.alias ? <p className="mt-1.5 text-[15px] text-ink-muted">{game.alias}</p> : null}
          <p className="mt-4 max-w-[56ch] text-[20px] leading-relaxed text-ink">{game.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {game.tags.map((tag) => (
              <TagChip key={tag.slug} name={tag.name} />
            ))}
          </div>

          <div className="mt-6">
            <OutboundCTA gameId={game.id} locale={locale} ctaUrl={game.ctaUrl} outboundAllowed={game.outboundAllowed} />
          </div>
          <p className="mt-3 max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">{t("ctaDisclosure")}</p>

          <p className="mt-5 flex items-center gap-2 text-[13px] text-ink-muted">
            <span aria-hidden="true" className="inline-block size-2 rounded-full bg-moss" />
            {tFields("verifiedOn", { date: formatDate(game.sourceFetchedAt, locale) })}
            <span aria-hidden="true">·</span>
            CrazyGames
          </p>
        </div>
      </div>

      {/* Lower: description + controls | full field notes */}
      <div className="mt-16 grid gap-10 border-t border-hairline pt-12 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <section>
            <h2 className="font-display text-[22px] font-semibold tracking-tight text-ink">{t("intro")}</h2>
            <div className="mt-4 max-w-[68ch] space-y-4">
              {game.description
                .split(/\n{2,}|\n/)
                .filter((p) => p.trim())
                .map((paragraph, i) => (
                  <p key={i} className="text-[16px] leading-[1.75] text-ink">
                    {paragraph}
                  </p>
                ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-display text-[22px] font-semibold tracking-tight text-ink">{t("controls")}</h2>
            {game.controls.trim() ? (
              <ul className="mt-4 max-w-[520px] divide-y divide-hairline overflow-hidden rounded-card border border-hairline">
                {game.controls
                  .split("\n")
                  .filter((line) => line.trim())
                  .map((line, i) => {
                    const [key, ...rest] = line.split(/[:：]/);
                    const action = rest.join(":").trim() || key.trim();
                    const keyPart = rest.length > 0 ? key.trim() : "";
                    return (
                      <li key={i} className="flex items-center gap-4 bg-surface px-4 py-3">
                        {keyPart ? (
                          <>
                            <Kbd>{keyPart}</Kbd>
                            <span className="min-w-0 break-words text-[14px] text-ink">{action}</span>
                          </>
                        ) : (
                          <span className="min-w-0 break-words text-[14px] text-ink">{action}</span>
                        )}
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="mt-3 text-[15px] italic text-ink-muted">{t("controlsPending")}</p>
            )}
          </section>
        </div>

        <div className="min-w-0 lg:col-span-5">
          <FieldNotes
            rows={[
              {
                label: tFields("developer"),
                value: game.developer || <span className="italic text-ink-muted">{tFields("unverified")}</span>,
              },
              {
                label: tFields("devices"),
                value: (
                  <>
                    {game.deviceSupport === "unknown"
                      ? t("deviceUnknown")
                      : tFields(`device${game.deviceSupport.charAt(0).toUpperCase()}${game.deviceSupport.slice(1)}`)}
                    {game.deviceEvidence ? (
                      <>
                        {" · "}
                        <a
                          href={game.deviceEvidence.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all underline decoration-hairline underline-offset-4 hover:decoration-ink"
                        >
                          {tFields("verifiedOn", { date: formatDate(game.deviceEvidence.checkedAt, locale) })}
                        </a>
                      </>
                    ) : null}
                  </>
                ),
              },
              {
                label: tFields("sourceAndVerified"),
                value: (
                  <>
                    <a
                      href={game.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-hairline underline-offset-4 hover:decoration-ink"
                    >
                      {game.sourceUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                    </a>
                    <span className="mt-1 block text-[13px] text-ink-muted">
                      {formatDateTime(game.sourceFetchedAt, locale)}
                    </span>
                  </>
                ),
              },
              {
                label: tFields("firstCollected"),
                value: formatDate(game.firstPublishedAt, locale),
              },
              {
                label: tFields("externalPlatform"),
                value: "CrazyGames",
              },
            ]}
          />
        </div>
      </div>

      {/* Next stops: related games (PRD 18, DESIGN §6.3) */}
      {game.related.length > 0 ? (
        <section className="mt-16 border-t border-hairline pt-12">
          <div className="flex items-center gap-3">
            <TrailLine />
            <h2 className="font-display text-[28px] font-semibold tracking-tight text-ink">{t("related")}</h2>
          </div>
          <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {game.related.map((related) => (
              <GameCard
                key={related.id}
                game={related}
                entry="related"
                makeHref={(s) => `/${locale}/games/${s}`}
                relatedEvent={{ gameId: related.id, sourceGameId: game.id, locale: locale }}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="pb-16 sm:pb-0">
        <StickyCTA gameId={game.id} locale={locale} ctaUrl={game.ctaUrl} outboundAllowed={game.outboundAllowed} />
      </div>
    </div>
  );
}
