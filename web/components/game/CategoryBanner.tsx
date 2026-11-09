import type { GameCard } from "@/lib/api/types";
import { CategoryCollage } from "./CategoryCollage";

/**
 * Category banner (DESIGN §6.5): the category's cover collage (TrailCover
 * when it has no cover art) with the category name overlaid as HTML text.
 */
export function CategoryBanner({
  slug,
  name,
  count,
  games = [],
}: {
  slug: string;
  name: string;
  count?: number;
  games?: GameCard[];
}) {
  return (
    <div className="relative h-[180px] overflow-hidden rounded-card border border-hairline sm:h-[220px] lg:h-[280px]">
      <CategoryCollage
        slug={slug}
        games={games}
        max={4}
        maxMobile={3}
        fanClassName="inset-x-4 top-2 h-[62%] sm:inset-x-auto sm:right-[4%] sm:top-1/2 sm:h-[86%] sm:w-[54%] sm:-translate-y-1/2"
        sizes="(min-width: 1024px) 300px, (min-width: 640px) 220px, 160px"
        priority
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/45 to-transparent p-6 lg:p-8">
        <h1 className="font-display text-[36px] font-bold leading-none tracking-tight text-[#F5F1E8] lg:text-[56px]">
          {name}
        </h1>
        {count != null ? (
          <span className="label-mono rounded-full bg-[#F5F1E8]/90 px-3 py-1.5 text-[#1B1A17]">
            {count}
          </span>
        ) : null}
      </div>
    </div>
  );
}
