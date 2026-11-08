"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/** Retry affordance for server-rendered error states (PRD 5.1.6). */
export function RetryButton() {
  const t = useTranslations("empty");
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex h-11 items-center rounded-input bg-ink px-5 text-[14px] font-medium text-paper"
    >
      {t("retry")}
    </button>
  );
}
