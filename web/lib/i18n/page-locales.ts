/**
 * Records the current page's available locales, set by the game detail page,
 * so language switchers can fall back to the target locale's home when the
 * current page does not exist there (PRD 4.2 §04 step 6, E19).
 */

let current: { path: string; locales: string[] } | null = null;

export function setPageAvailableLocales(path: string, locales: string[]): void {
  current = { path, locales };
}

/** Available locales recorded for exactly this path, or null. */
export function availableLocalesForPath(path: string): string[] | null {
  return current && current.path === path ? current.locales : null;
}

/** True on a game-detail path, where availability comes from the detail payload. */
export function isGameDetailPath(pathname: string): boolean {
  return /^\/[^/]+\/games\/[^/]+$/.test(pathname);
}
