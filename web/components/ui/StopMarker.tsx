/** Station marker: numbered stop on the trail (DESIGN §3.2). */
export function StopMarker({
  n,
  current = false,
  size = 28,
}: {
  n: number;
  current?: boolean;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, minWidth: size }}
      className={`inline-flex items-center justify-center rounded-full font-mono text-[12px] font-medium ${
        current ? "bg-trail text-trail-ink" : "bg-ink text-paper"
      }`}
    >
      {String(n).padStart(2, "0")}
    </span>
  );
}
