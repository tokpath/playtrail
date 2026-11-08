"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics";
import { setPageAvailableLocales } from "@/lib/i18n/page-locales";

/** Fire the game_view event once per route entry (PRD 11) and record the
 * locales this game is live in for the language switchers (E19, PRD 4.2). */
export function GameViewTracker({
  gameId,
  locale,
  availableLocales,
}: {
  gameId: string;
  locale: string;
  availableLocales: string[];
}) {
  const pathname = usePathname();
  useEffect(() => {
    track({ eventName: "game_view", placement: "detail_page", gameId, locale });
  }, [gameId, locale]);
  useEffect(() => {
    setPageAvailableLocales(pathname, availableLocales);
  }, [pathname, availableLocales]);
  return null;
}
