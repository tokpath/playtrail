import type { ReactNode } from "react";

/**
 * Field-notes fact panel (DESIGN §3.4): two-column dt/dd with hairline rows.
 * Values flagged unverified render muted with a hollow dot; verified values
 * get a solid moss dot plus the date.
 */
export function FieldNotes({
  rows,
  title,
}: {
  title?: ReactNode;
  rows: { label: ReactNode; value: ReactNode }[];
}) {
  return (
    <dl className="overflow-hidden rounded-card border border-hairline bg-surface">
      {title ? (
        <div className="border-b border-hairline px-5 py-3">
          <h2 className="label-mono text-ink-muted">{title}</h2>
        </div>
      ) : null}
      {rows.map((row, i) => (
        <div
          key={i}
          className={`grid grid-cols-[minmax(120px,32%)_1fr] gap-x-4 px-5 py-3.5 ${i > 0 ? "border-t border-hairline" : ""}`}
        >
          <dt className="label-mono-sm pt-0.5 text-ink-muted">{row.label}</dt>
          <dd className="min-w-0 break-words text-[14px] leading-relaxed text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
