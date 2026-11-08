import { postEvent } from "@/lib/api/client";
import type { EventInput } from "@/lib/api/types";

/**
 * Product analytics per PRD 11: three whitelisted events, no cookies, no
 * persistent identifiers. Entry source is passed through sessionStorage as a
 * single-use value that the next detail view consumes and deletes.
 * When DNT or GPC is enabled, no events are sent but the page keeps working.
 */

const ENTRY_SOURCE_KEY = "pt_entry";

export type EntrySource = EventInput["entrySource"];

function trackingOptedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const dnt = navigator.doNotTrack ?? (navigator as { msDoNotTrack?: string }).msDoNotTrack;
  const gpc = (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl;
  return dnt === "1" || gpc === true;
}

function pagePath(): string {
  return window.location.pathname;
}

export function setEntrySource(source: EntrySource): void {
  try {
    sessionStorage.setItem(ENTRY_SOURCE_KEY, source);
  } catch {
    // Storage unavailable (private mode); entrySource falls back to direct.
  }
}

/** Read the stored entry source without consuming it (E22: the related_click
 * event reports the current page's entry source; the next detail view still
 * needs the stored value). */
export function peekEntrySource(): EntrySource {
  try {
    const value = sessionStorage.getItem(ENTRY_SOURCE_KEY);
    if (
      value === "home_featured" ||
      value === "home_hot" ||
      value === "category" ||
      value === "search" ||
      value === "related"
    ) {
      return value;
    }
  } catch {
    // Ignore storage errors; fall through to direct.
  }
  return "direct_or_unknown";
}

export function consumeEntrySource(): EntrySource {
  try {
    const value = sessionStorage.getItem(ENTRY_SOURCE_KEY);
    sessionStorage.removeItem(ENTRY_SOURCE_KEY);
    if (
      value === "home_featured" ||
      value === "home_hot" ||
      value === "category" ||
      value === "search" ||
      value === "related"
    ) {
      return value;
    }
  } catch {
    // Ignore storage errors; fall through to direct.
  }
  return "direct_or_unknown";
}

type TrackArgs = {
  eventName: EventInput["eventName"];
  placement: EventInput["placement"];
  gameId: string;
  /** Site locale; narrowed to the API's Locale union at the call boundary. */
  locale: string;
  sourceGameId?: string;
  /** Explicit entry source, read without consuming the stored one (E22). */
  entrySource?: EntrySource;
};

export function track({ eventName, placement, gameId, locale, sourceGameId, entrySource }: TrackArgs): void {
  // Consume the entry source before the opt-out check so a DNT visitor does
  // not leak a stale value into a later navigation — unless the caller
  // supplies an explicit, non-consuming value.
  const resolved = entrySource ?? consumeEntrySource();
  if (trackingOptedOut()) return;
  const event: EventInput = {
    eventId: crypto.randomUUID(),
    eventName,
    gameId,
    sourceGameId,
    pageType: "detail",
    pagePath: pagePath(),
    locale: locale as EventInput["locale"],
    occurredAt: new Date().toISOString(),
    placement,
    entrySource: resolved,
  };
  postEvent(event);
}
