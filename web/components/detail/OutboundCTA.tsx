"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { track } from "@/lib/analytics";

/**
 * Primary outbound CTA (DESIGN §4.3, PRD 11): a real anchor to the verified
 * external URL; the click event is sent best-effort and never blocks or
 * retries navigation.
 */
export function OutboundCTA({
  gameId,
  locale,
  ctaUrl,
  outboundAllowed,
}: {
  gameId: string;
  locale: string;
  ctaUrl: string;
  outboundAllowed: boolean;
}) {
  const t = useTranslations("detail");
  if (!outboundAllowed) return <UnavailableCTA />;

  return (
    <a
      id="primary-cta"
      href={ctaUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track({ eventName: "outbound_click", placement: "detail_primary", gameId, locale })}
      className="group/cta flex h-14 min-h-[44px] w-full max-w-[420px] items-center justify-center gap-2 rounded-cta bg-trail px-7 text-[17px] font-bold text-trail-ink transition-transform active:scale-[0.98] sm:w-auto"
    >
      {t("playCta")}
      <span aria-hidden="true" className="transition-transform duration-150 group-hover/cta:-translate-y-0.5 group-hover/cta:translate-x-0.5">
        ↗
      </span>
    </a>
  );
}

function UnavailableCTA() {
  const t = useTranslations("detail");
  return (
    <div>
      <span
        aria-disabled="true"
        className="flex h-14 w-full max-w-[420px] cursor-not-allowed items-center justify-center rounded-cta bg-surface-sunk px-7 text-[17px] font-bold text-ink-muted sm:w-auto"
      >
        {t("ctaDisabled")}
      </span>
      <p className="mt-3 max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">{t("externalUnavailable")}</p>
    </div>
  );
}

/**
 * Sticky mobile CTA bar: appears once the visitor has scrolled past the main
 * CTA (`#primary-cta`) (PRD §05, DESIGN §6.3).
 */
export function StickyCTA({
  gameId,
  locale,
  ctaUrl,
  outboundAllowed,
}: {
  gameId: string;
  locale: string;
  ctaUrl: string;
  outboundAllowed: boolean;
}) {
  const t = useTranslations("detail");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sentinel = document.getElementById("primary-cta");
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  if (!outboundAllowed) return null;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-paper/95 px-4 pt-3 backdrop-blur-sm transition-transform duration-200 sm:hidden ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-hidden={!visible}
    >
      <a
        href={ctaUrl}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={visible ? 0 : -1}
        onClick={() => track({ eventName: "outbound_click", placement: "detail_primary", gameId, locale })}
        className="flex h-14 items-center justify-center rounded-cta bg-trail text-[17px] font-bold text-trail-ink"
      >
        {t("playCta")}
      </a>
    </div>
  );
}
