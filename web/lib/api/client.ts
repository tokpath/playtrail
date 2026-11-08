import type { EventInput } from "./types";

/**
 * Fire-and-forget event delivery to POST /api/events (proxied to the Go API).
 * Never awaited and never retried; the backend dedupes on eventId so a best
 * effort send is all we promise (PRD 11). keepalive fetch survives navigation
 * like sendBeacon and never blocks; sendBeacon is the fallback when the
 * keepalive budget is exhausted.
 */
export function postEvent(event: EventInput): void {
  const body = JSON.stringify(event);
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Statistics must never surface an error or block navigation.
    });
  } catch {
    // keepalive fetch can throw synchronously when its budget is exhausted.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
    }
  }
}
