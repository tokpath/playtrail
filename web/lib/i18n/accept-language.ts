/**
 * Accept-Language parsing per PRD 4.2.
 *
 * 1. Parse into (tag, q) pairs in original order; skip malformed entries,
 *    `q=0` and `*`. An entirely malformed header counts as no header.
 * 2. Sort by q descending, stable (original order for equal q).
 * 3. Match against candidate locales: first by exact tag (case-insensitive),
 *    then by primary language subtag.
 * 4. No hit → default locale.
 */

export type AcceptLanguageEntry = { tag: string; q: number; index: number };

export function parseAcceptLanguage(header: string | null | undefined): AcceptLanguageEntry[] {
  if (!header) return [];
  const entries: AcceptLanguageEntry[] = [];
  const parts = header.split(",");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    const [tagPart, ...paramParts] = part.split(";");
    const tag = tagPart.trim().toLowerCase();
    if (!tag || tag === "*" || !/^[a-z]{1,8}(-[a-z0-9]{1,8})*$/.test(tag)) continue;
    let q = 1;
    let valid = true;
    for (const param of paramParts) {
      const [key, value] = param.split("=");
      if (key?.trim() === "q") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
          valid = false;
          break;
        }
        q = parsed;
      }
    }
    if (!valid || q === 0) continue;
    entries.push({ tag, q, index: i });
  }
  // Stable sort by q descending (Array.prototype.sort is stable in ES2019+).
  return entries.sort((a, b) => b.q - a.q);
}

/**
 * Match a parsed header against available locales.
 * `zh` special rule per PRD 4.2: zh-TW/HK/MO/Hant also match `zh` while only
 * the Simplified variant is live. Implement as: the primary subtag match
 * already covers zh-TW → zh; full-tag matches win first, which will prefer
 * `zh-hant` once it is itself listed as a locale.
 */
export function matchLocale(header: string | null | undefined, locales: string[]): string | null {
  const entries = parseAcceptLanguage(header);
  for (const entry of entries) {
    for (const locale of locales) {
      if (entry.tag === locale.toLowerCase()) return locale;
    }
    const primary = entry.tag.split("-")[0];
    for (const locale of locales) {
      if (locale.toLowerCase().startsWith(primary + "-") || locale.toLowerCase() === primary) {
        return locale;
      }
    }
  }
  return null;
}
