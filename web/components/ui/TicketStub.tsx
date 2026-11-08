import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/i18n/format";

/** Collection ticket stub for hot snapshots (DESIGN §3.3). */
export async function TicketStub({
  fetchedAt,
  region,
  stale = false,
}: {
  fetchedAt: string;
  region: string;
  stale?: boolean;
}) {
  const t = await getTranslations("hot");
  const locale = await getLocale();
  return (
    <div
      className={`ticket-stub border-y ${stale ? "border-amber bg-amber/[0.07]" : "border-hairline bg-surface"} px-6 py-3`}
    >
      <p className="label-mono flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted">
        <span>{t("collected", { time: formatDate(fetchedAt, locale) })}</span>
        <span aria-hidden="true">·</span>
        <span>{t("region", { region })}</span>
        <span aria-hidden="true">·</span>
        <span>{t("definitionShort")}</span>
      </p>
    </div>
  );
}
