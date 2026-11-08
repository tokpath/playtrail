import { getTranslations } from "next-intl/server";
import type { GameCard as GameCardData } from "@/lib/api/types";
import { GameCover } from "./GameCover";
import { TrackedLink } from "@/components/layout/TrackedLink";

type Variant = "lg" | "md" | "row";

/**
 * Game card (DESIGN §4.2). The whole card is one link; hover lifts the cover
 * (shadow + contour parallax) and underlines the title in trail color. No
 * card chrome — the cover border does the layering.
 */
export async function GameCard({
  game,
  variant = "md",
  entry,
  makeHref,
  priority = false,
  position,
  relatedEvent,
}: {
  game: GameCardData;
  variant?: Variant;
  entry: Parameters<typeof TrackedLink>[0]["entry"];
  makeHref: (slug: string) => string;
  priority?: boolean;
  position?: number;
  /** E22: set on detail-page related stops to fire one related_click. */
  relatedEvent?: { gameId: string; sourceGameId: string; locale: string };
}) {
  const t = await getTranslations();
  const isLg = variant === "lg";
  const isRow = variant === "row";

  const titleSize = isLg ? "text-[32px]" : isRow ? "text-[18px]" : "text-[20px]";
  const summaryLines = isLg ? "line-clamp-3" : "line-clamp-2";
  const summarySize = isLg ? "text-[15px]" : "text-[14px]";

  return (
    <TrackedLink href={makeHref(game.slug)} entry={entry} className="group block" ariaLabel={game.name} relatedEvent={relatedEvent}>
      <article className={isRow ? "flex gap-4" : ""}>
        <div className={`relative ${isRow ? "shrink-0" : "card-hover"}`}>
          <GameCover
            cover={game.cover}
            slug={game.slug}
            category={game.primaryCategory.slug}
            name={game.name}
            priority={priority}
            alt=""
            className={isRow ? "w-[120px] transition-transform group-hover:-translate-y-0.5" : ""}
            sizes={isRow ? "120px" : undefined}
          />
          {/* corner pill: category name; suppressed when a hot position
              number occupies the same corner (DESIGN §6.1.3) */}
          {position == null ? (
            <span
              className={`absolute left-2.5 top-2.5 max-w-[calc(100%-20px)] truncate rounded-full border border-hairline bg-surface px-2.5 py-1 ${game.outboundAllowed ? "" : "border-signal"}`}
            >
              <span className={`label-mono-sm ${game.outboundAllowed ? "text-ink" : "text-signal"}`}>
                {game.outboundAllowed ? game.primaryCategory.name : t("card.linkUnavailable")}
              </span>
            </span>
          ) : null}
          {position != null ? (
            <span
              aria-hidden="true"
              className="text-outline pointer-events-none absolute top-1/2 left-0 -translate-x-[70%] -translate-y-1/2 font-display text-[64px] font-extrabold leading-none"
            >
              {position}
            </span>
          ) : null}
        </div>
        <div className={isRow ? "min-w-0 flex-1" : "mt-3"}>
          <h3
            className={`${titleSize} font-display font-semibold leading-snug tracking-tight text-ink decoration-trail decoration-2 underline-offset-4 group-hover:underline`}
          >
            {game.name}
          </h3>
          {game.summary ? (
            <p className={`${summarySize} ${summaryLines} mt-1 text-ink-muted`}>{game.summary}</p>
          ) : null}
          {!isRow ? (
            <p className="label-mono-sm mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-ink-muted">
              {game.tags.slice(0, 3).map((tag) => (
                <span key={tag.slug} className="flex items-center gap-1">
                  <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-ink-muted/60" />
                  {tag.name}
                </span>
              ))}
            </p>
          ) : null}
          {isLg ? (
            <span className="label-mono-sm mt-3 inline-flex items-center gap-1.5 text-trail">
              {t("home.viewDetail")}
              <span aria-hidden="true">→</span>
            </span>
          ) : null}
        </div>
      </article>
    </TrackedLink>
  );
}
