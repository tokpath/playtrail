import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getHot, getLiveLocales } from "@/lib/api/server";
import { pageMetadata } from "@/lib/seo";
import { GameCard } from "@/components/game/GameCard";
import { TicketStub } from "@/components/ui/TicketStub";
import { EmptyState } from "@/components/ui/EmptyState";
import { RetryButton } from "@/components/layout/RetryButton";

export async function generateMetadata({ params }: PageProps<"/[locale]/hot">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.hot" });
  const liveLocales = await safeLiveLocales();
  return pageMetadata({ locale, liveLocales, path: `/${locale}/hot`, title: t("title"), description: t("title") });
}

async function safeLiveLocales(): Promise<string[]> {
  try {
    return await getLiveLocales();
  } catch {
    return [];
  }
}

export default async function HotPage({ params }: PageProps<"/[locale]/hot">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("hot");
  const tEmpty = await getTranslations("empty");

  let snapshot: Awaited<ReturnType<typeof getHot>>["snapshot"] | null = null;
  let failed = false;
  try {
    snapshot = (await getHot(locale)).snapshot;
  } catch {
    failed = true;
  }

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-12 sm:px-6">
      <h1 className="font-display text-[36px] font-bold tracking-tight text-ink">{t("title")}</h1>
      <p className="mt-4 max-w-[68ch] text-[16px] leading-relaxed text-ink-muted">{t("definition")}</p>

      {snapshot ? (
        <>
          {snapshot.stale ? (
            <div className="mt-6 rounded-card border-l-[3px] border-amber bg-amber/[0.07] px-4 py-3">
              <p className="text-[14px] font-medium text-amber">{t("staleBanner")}</p>
            </div>
          ) : null}
          <div className="mt-6">
            <TicketStub fetchedAt={snapshot.sourceFetchedAt} region={snapshot.observedRegion} stale={snapshot.stale} />
          </div>

          <ol className="mt-10 flex flex-col gap-9">
            {snapshot.items.map((item) => (
              <li key={item.position} className="flex items-start gap-5">
                <span
                  aria-hidden="true"
                  className="text-outline w-[72px] shrink-0 text-right font-display text-[64px] font-extrabold leading-[0.9]"
                >
                  {item.position}
                </span>
                <span className="min-w-0 flex-1 pt-2">
                  <GameCard game={item.game} variant="row" entry="home_hot" makeHref={(s) => `/${locale}/games/${s}`} />
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="mt-10">
          {failed ? (
            <div className="flex flex-col items-center gap-4 rounded-card border border-hairline bg-surface px-6 py-16 text-center">
              <p className="text-[15px] text-signal">{tEmpty("errorTitle")}</p>
              <p className="max-w-[48ch] text-[14px] text-ink-muted">{tEmpty("errorBody")}</p>
              <RetryButton />
            </div>
          ) : (
            <EmptyState
              title={t("empty.title")}
              body={t("empty.body")}
              actions={
                <Link
                  href={`/${locale}/games`}
                  className="inline-flex h-11 items-center rounded-input bg-ink px-5 text-[14px] font-medium text-paper"
                >
                  {tEmpty("browseAll")}
                </Link>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
