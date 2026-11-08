import type { ReactNode } from "react";
import { TrailLine } from "./TrailLine";

/**
 * Empty / gone / 404 state with the trail illustration (DESIGN §4.5):
 * a strip of contours, a broken trail, and a signpost. Decorative SVG.
 */
export function EmptyState({
  title,
  body,
  actions,
  tone = "plain",
}: {
  title: ReactNode;
  body?: ReactNode;
  actions?: ReactNode;
  tone?: "plain" | "stale";
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-card border px-6 py-14 text-center ${tone === "stale" ? "border-amber bg-amber/[0.06]" : "border-hairline bg-surface"}`}
    >
      <EmptyIllustration />
      <h2 className="mt-6 font-display text-[22px] font-semibold tracking-tight text-ink">{title}</h2>
      {body ? <p className="mt-2 max-w-[48ch] text-[15px] text-ink-muted">{body}</p> : null}
      {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
    </div>
  );
}

/** Shared empty-state illustration: contours, a broken trail, a signpost. */
export function EmptyIllustration() {
  return (
    <svg width="180" height="110" viewBox="0 0 180 110" aria-hidden="true" className="text-ink">
      {/* contours */}
      <g fill="none" stroke="currentColor" opacity="0.14">
        <path d="M20 96 C 30 60, 70 54, 86 74 C 100 92, 128 88, 138 66" />
        <path d="M34 100 C 44 72, 74 66, 88 82 C 100 96, 122 94, 130 78" />
        <path d="M48 104 C 58 84, 80 78, 92 90" />
        <ellipse cx="138" cy="34" rx="26" ry="12" />
        <ellipse cx="138" cy="34" rx="14" ry="6" />
      </g>
      {/* broken trail */}
      <path d="M12 58 C 40 40, 60 76, 84 58" fill="none" stroke="var(--trail)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 7" />
      <circle cx="84" cy="58" r="4" fill="var(--trail)" />
      <path d="M118 34 C 132 30, 144 40, 168 32" fill="none" stroke="var(--trail)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 7" />
      {/* signpost */}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="118" y1="98" x2="118" y2="52" />
        <path d="M118 54 L 96 54 L 90 60 L 96 66 L 118 66" fill="var(--paper)" />
        <line x1="112" y1="70" x2="112" y2="80" strokeDasharray="2 4" opacity="0.5" />
      </g>
      <circle cx="118" cy="98" r="3" fill="var(--trail)" />
    </svg>
  );
}

/** Small inline broken-trail mark used beside 404/section titles. */
export function BrokenTrailMark() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      <TrailLine />
      <svg width="18" height="12" viewBox="0 0 18 12">
        <circle cx="3" cy="6" r="3" fill="var(--trail)" />
        <path d="M9 6 h2 M14 6 h2" stroke="var(--trail)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
      </svg>
    </span>
  );
}
