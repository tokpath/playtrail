import { ImageResponse } from "next/og";
import { getGame } from "@/lib/api/server";
import { categoryColors, planTrailCover, letterPlacement } from "@/lib/cover";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// alt must be a plain string per the file convention.
export const alt = "PlayTrail game share image";

type ImageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

/**
 * Per-game share image (DESIGN §5): left 60% an enlarged TrailCover, right
 * 40% paper with the game name, category and site mark. Satori can't run the
 * full SVG pipeline, so the cover geometry is precomputed here and rendered
 * as a data-URI image.
 */
export default async function OpengraphImage({ params }: ImageProps) {
  const { locale, slug } = await params;
  let game: Awaited<ReturnType<typeof getGame>> | null = null;
  try {
    game = await getGame(locale, slug);
  } catch {
    game = null;
  }
  const name = game?.name ?? slug;
  const category = game?.primaryCategory.slug ?? "action";
  const categoryName = game?.primaryCategory.name ?? "";
  const colors = categoryColors(category);
  const plan = planTrailCover(`share:${slug}`, 760, 630);
  const letter = (name.replace(/^the\s+/i, "").match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const letterX = letterPlacement(letter, 300, 760);
  const letterY = Math.round(672);

  const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="630" viewBox="0 0 760 630">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${plan.gradientAngle.toFixed(1)} 380 315)">
      <stop offset="0%" stop-color="${colors.base}"/><stop offset="100%" stop-color="${colors.deep}"/>
    </linearGradient>
    <radialGradient id="light" cx="${(plan.light.cx / 760).toFixed(3)}" cy="${(plan.light.cy / 630).toFixed(3)}" r="0.55">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="760" height="630" fill="url(#bg)"/>
  <rect width="760" height="630" fill="url(#light)"/>
  ${plan.contours
    .map(
      (d, i) =>
        `<path d="${d}" fill="none" stroke="#F5F1E8" stroke-width="2" opacity="${(0.38 - (0.26 / 8) * i).toFixed(3)}"/>`,
    )
    .join("\n  ")}
  <path d="${plan.trail.d}" fill="none" stroke="#F5F1E8" stroke-opacity="0.85" stroke-width="3" stroke-dasharray="4 12" stroke-linecap="round"/>
  <circle cx="${plan.trail.dot.x.toFixed(0)}" cy="${plan.trail.dot.y.toFixed(0)}" r="13" fill="#FF5B1F" stroke="#F5F1E8" stroke-width="4"/>
  <text x="${letterX.toFixed(0)}" y="${letterY}" font-size="300" font-weight="800" fill="#F5F1E8" fill-opacity="0.92">${letter}</text>
</svg>`;

  const coverDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(coverSvg)}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#F5F1E8",
        }}
      >
        <div style={{ width: "60%", height: "100%", display: "flex" }}>
          <img src={coverDataUri} width={760} height={630} alt="" style={{ objectFit: "cover" }} />
        </div>
        <div
          style={{
            width: "40%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "48px 44px",
            color: "#1B1A17",
          }}
        >
          <div style={{ display: "flex", fontSize: 24, letterSpacing: 2, textTransform: "uppercase", color: "#6B665C" }}>
            {categoryName}
          </div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2 }}>{name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 700, color: "#FF5B1F" }}>
            <svg width="26" height="26" viewBox="0 0 18 18">
              <path d="M3 14 C 6 8, 10 12, 15 4" fill="none" stroke="#FF5B1F" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 5" />
              <circle cx="3" cy="14" r="2.6" fill="#1B1A17" />
              <circle cx="15" cy="4" r="2.6" fill="#FF5B1F" />
            </svg>
            PlayTrail
          </div>
        </div>
      </div>
    ),
    size,
  );
}
