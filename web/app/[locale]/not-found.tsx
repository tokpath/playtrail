import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

/** Localized 404 for unmatched paths under a valid locale prefix (PRD 4.1). */
export default async function NotFound() {
  const t = await getTranslations("empty");
  return (
    <div className="mx-auto max-w-[720px] px-4 py-16 sm:px-6">
      <EmptyState
        title={t("notFoundTitle")}
        body={t("notFoundBody")}
        actions={
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-input border border-hairline px-5 text-[14px] text-ink hover:border-ink"
          >
            {t("backHome")}
          </Link>
        }
      />
    </div>
  );
}
