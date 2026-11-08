"use client";

import { useId } from "react";
import { categoryColors, leadingLetter, letterPlacement, planTrailCover } from "@/lib/cover";

/**
 * Deterministic generative cover (DESIGN §5). Server-rendered inline SVG,
 * same slug → identical output everywhere. Decorative: always aria-hidden,
 * cards carry the real text title.
 *
 * Ink colors inside the cover are fixed (not scheme tokens) so renders are
 * identical everywhere, including across light/dark; the cover sits on its
 * own gradient, like printed art in a book.
 */
const PAPER = "#F5F1E8";
const TRAIL = "#FF5B1F";

export function TrailCover({
  slug,
  category,
  name,
  banner = false,
  className = "",
}: {
  slug: string;
  category: string;
  name: string;
  banner?: boolean;
  className?: string;
}) {
  const seed = banner ? `banner:${slug}` : slug;
  const width = banner ? 1240 : 320;
  const height = banner ? 280 : 180;
  const colors = categoryColors(category);
  const plan = planTrailCover(seed, width, height);
  // Per-instance ids: two covers with the same slug must not share defs, or a
  // hidden instance (display:none) can break the other's paint.
  const rawId = useId();
  const id = `tc${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const letter = leadingLetter(name);
  const letterX = letterPlacement(letter, 170, width);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      className={`h-full w-full ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-bg`} gradientTransform={`rotate(${plan.gradientAngle.toFixed(1)} ${width / 2} ${height / 2})`}>
          <stop offset="0%" stopColor={colors.base} />
          <stop offset="100%" stopColor={colors.deep} />
        </linearGradient>
        <radialGradient id={`${id}-light`} cx={(plan.light.cx / width).toFixed(3)} cy={(plan.light.cy / height).toFixed(3)} r="0.55">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#${id}-bg)`} />
      <rect width={width} height={height} fill={`url(#${id}-light)`} />
      <g className="cover-contours">
        {plan.contours.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={PAPER}
            strokeWidth="1.1"
            opacity={(0.38 - (0.26 / 8) * i).toFixed(3)}
          />
        ))}
      </g>
      <path
        d={plan.trail.d}
        fill="none"
        stroke={PAPER}
        strokeOpacity="0.85"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 6"
      />
      <circle cx={plan.trail.dot.x} cy={plan.trail.dot.y} r="7" fill={TRAIL} stroke={PAPER} strokeWidth="2" />
      {!banner && (
        <text
          x={letterX}
          y={192}
          fontSize="150"
          fontWeight="800"
          fill={PAPER}
          fillOpacity="0.92"
          style={{ fontFamily: "var(--font-display)", mixBlendMode: "soft-light" }}
        >
          {letter}
        </text>
      )}
      <rect width={width} height={height} filter="url(#pt-grain)" opacity="0.06" />
    </svg>
  );
}
