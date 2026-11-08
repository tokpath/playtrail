"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { peekEntrySource, setEntrySource, track, type EntrySource } from "@/lib/analytics";

/**
 * Internal link that records the click context for the next detail view's
 * entrySource (PRD 11, ARCHITECTURE §8). Single-use value in sessionStorage;
 * no cookies. When `relatedEvent` is set, the click also fires exactly one
 * related_click event (E22, PRD 11: placement detail_related, sourceGameId
 * = the current game); sendBeacon/keepalive never blocks navigation.
 */
export function TrackedLink({
  href,
  entry,
  children,
  className,
  ariaLabel,
  relatedEvent,
}: {
  href: string;
  entry: EntrySource;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  relatedEvent?: { gameId: string; sourceGameId: string; locale: string };
}) {
  const handleClick = () => {
    if (relatedEvent) {
      // Fire before overwriting the stored entry source: the related_click
      // reports the current page's entry source (peeked, not consumed) while
      // the stored value is left for the next detail view (PRD 11).
      track({
        eventName: "related_click",
        placement: "detail_related",
        gameId: relatedEvent.gameId,
        sourceGameId: relatedEvent.sourceGameId,
        locale: relatedEvent.locale,
        entrySource: peekEntrySource(),
      });
    }
    setEntrySource(entry);
  };

  return (
    <Link href={href} className={className} aria-label={ariaLabel} onClick={handleClick}>
      {children}
    </Link>
  );
}
