import { useTranslations } from "next-intl";
import Link from "next/link";
import { StopMarker } from "./StopMarker";

/**
 * Stop-marker style pagination (DESIGN §6.2): numbers as trail stations,
 * current page trail-filled.
 */
export function Pagination({
  page,
  totalPages,
  makeHref,
}: {
  page: number;
  totalPages: number;
  makeHref: (page: number) => string;
}) {
  const t = useTranslations("pagination");
  if (totalPages <= 1) return null;
  const pages = pageNumbers(page, totalPages);

  return (
    <nav aria-label={t("label")} className="mt-12 flex flex-wrap items-center justify-center gap-2">
      {pages.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} aria-hidden="true" className="label-mono px-2 text-ink-muted">
            …
          </span>
        ) : p === page ? (
          <StopMarker key={p} n={p} current />
        ) : (
          <Link
            key={p}
            href={makeHref(p)}
            className="label-mono flex size-9 items-center justify-center rounded-full border border-hairline text-ink transition-colors hover:border-ink"
          >
            {p}
          </Link>
        ),
      )}
    </nav>
  );
}

function pageNumbers(page: number, total: number): (number | "gap")[] {
  const max = 5;
  if (total <= max + 2) return range(1, total);
  const pages = new Set<number>([1, total, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
