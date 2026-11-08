import { planTrailCover } from "@/lib/cover";

/** Thin contour band used atop legal pages (DESIGN §6.6): ink lines at 8%. */
export function ContourStrip({ seed = "legal" }: { seed?: string }) {
  const plan = planTrailCover(seed, 1240, 420);
  return (
    <div aria-hidden="true" className="h-16 overflow-hidden border-y border-hairline">
      <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="60 178 1120 64">
        {plan.contours.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--ink)" strokeWidth="1" opacity="0.08" />
        ))}
      </svg>
    </div>
  );
}
