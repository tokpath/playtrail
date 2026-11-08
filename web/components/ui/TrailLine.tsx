/** Dashed trail connector (DESIGN §3.1). Vertical variant links the stop
 * markers on the home "today's trail" rail; the horizontal variant sits
 * beside section titles. Decorative. */
export function TrailLine({ vertical = false, length }: { vertical?: boolean; length?: number }) {
  if (vertical) {
    return (
      <svg
        aria-hidden="true"
        width="4"
        height={length}
        className="shrink-0"
        preserveAspectRatio="none"
        viewBox={`0 0 4 ${length}`}
      >
        <line
          x1="2"
          y1="0"
          x2="2"
          y2={length}
          stroke="var(--trail)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="2 7"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="56" height="12" viewBox="0 0 56 12" className="shrink-0">
      <line
        x1="0"
        y1="6"
        x2="56"
        y2="6"
        stroke="var(--trail)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 7"
      />
    </svg>
  );
}
