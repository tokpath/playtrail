import { TrailCover } from "./TrailCover";

/**
 * Category banner (DESIGN §5/§6.5): the TrailCover algorithm at 1240×280 with
 * the category name overlaid as HTML text (not inside the SVG).
 */
export function CategoryBanner({
  slug,
  name,
  count,
}: {
  slug: string;
  name: string;
  count?: number;
}) {
  return (
    <div className="relative h-[180px] overflow-hidden rounded-card border border-hairline sm:h-[220px] lg:h-[280px]">
      <TrailCover slug={slug} category={slug} name={slug} banner className="absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/35 to-transparent p-6 lg:p-8">
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
