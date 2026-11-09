import type { CSSProperties } from "react";
import type { GameCard } from "@/lib/api/types";
import { categoryColors, fnv1a32 } from "@/lib/cover";
import { GameCover } from "./GameCover";
import { TrailCover } from "./TrailCover";

/** Card tilt in degrees, picked per slot from a slug-seeded offset. */
const TILTS = [-7, 4, -3, 6, -5];

/** Position of card `i` of `n` in the fan box, both as percentages. */
function fanSlot(i: number, n: number): { left: number; width: number } {
  // Fewer cards get bigger; a single card is centered.
  const width = n === 1 ? 62 : n === 2 ? 54 : 44;
  const left = n === 1 ? (100 - width) / 2 : (i * (100 - width)) / (n - 1);
  return { left, width };
}

/**
 * Category artwork shared by the category banner and the home category tiles
 * (DESIGN §6.1.4/§6.5): the category's leading game covers fanned out as
 * tilted cards over a category-colored field. Only real cover art makes the
 * collage; a category without any falls back to the TrailCover topo art.
 * Fills its positioned parent; decorative only (the games are listed and
 * linked elsewhere on the page).
 */
export function CategoryCollage({
  slug,
  games,
  max,
  maxMobile = max,
  fanClassName,
  sizes,
  priority = false,
}: {
  slug: string;
  games: GameCard[];
  /** Most cards shown from `sm` up. */
  max: number;
  /** Most cards shown below `sm`. */
  maxMobile?: number;
  /** Size and position of the box the cards fan out in. */
  fanClassName: string;
  sizes: string;
  priority?: boolean;
}) {
  const covers = games.filter((g) => g.cover != null).slice(0, max);
  if (covers.length === 0) {
    return <TrailCover slug={slug} category={slug} name={slug} banner className="absolute inset-0" />;
  }

  const { base, deep } = categoryColors(slug);
  const n = covers.length;
  // Each card gets two slots: one for the phone layout, one from `sm` up.
  const mobileN = Math.min(n, maxMobile);
  const seed = fnv1a32(slug);

  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(120% 140% at 85% 20%, ${base} 0%, ${deep} 100%)` }}
      />
      <div className={`absolute ${fanClassName}`}>
        {covers.map((game, i) => {
          const lift = n === 1 ? 0 : i % 2 === 0 ? 14 : -14;
          const wide = fanSlot(i, n);
          const narrow = i < mobileN ? fanSlot(i, mobileN) : wide;
          const style = {
            "--fan-left": `${narrow.left}%`,
            "--fan-width": `${narrow.width}%`,
            "--fan-left-wide": `${wide.left}%`,
            "--fan-width-wide": `${wide.width}%`,
            transform: `translateY(calc(-50% + ${lift}%)) rotate(${TILTS[(seed + i) % TILTS.length]}deg)`,
            zIndex: i % 2 === 0 ? 1 : 2,
          } as CSSProperties;
          return (
            <div
              key={game.id}
              style={style}
              className={`absolute top-1/2 left-(--fan-left) w-(--fan-width) rounded-cover bg-[#F5F1E8] p-1 shadow-[0_10px_24px_rgba(0,0,0,0.35)] sm:left-(--fan-left-wide) sm:w-(--fan-width-wide) sm:p-1.5 ${i >= mobileN ? "hidden sm:block" : ""}`}
            >
              <GameCover
                cover={game.cover}
                slug={game.slug}
                category={game.primaryCategory.slug}
                name={game.name}
                alt=""
                priority={priority}
                sizes={sizes}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
