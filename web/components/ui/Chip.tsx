import type { ReactNode } from "react";

/** Filter chip (DESIGN §4.4): unselected hairline; selected ink-filled with ×. */
export function FilterChip({
  label,
  selected = false,
  onRemove,
  onClick,
}: {
  label: ReactNode;
  selected?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  if (selected && onRemove) {
    return (
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-9 min-w-[44px] items-center gap-1.5 rounded-full bg-ink px-3 text-[14px] text-paper"
      >
        {label}
        <span aria-hidden="true" className="text-[12px] opacity-70">
          ×
        </span>
        <span className="sr-only">{String(label)}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 min-w-[44px] items-center rounded-full border border-hairline bg-surface px-3 text-[14px] text-ink transition-colors hover:border-ink"
    >
      {label}
    </button>
  );
}

/** Static tag chip on cards and detail pages. */
export function TagChip({ name }: { name: string }) {
  return (
    <span className="label-mono-sm inline-flex items-center rounded-full border border-hairline px-2.5 py-1 text-ink-muted">
      {name}
    </span>
  );
}
