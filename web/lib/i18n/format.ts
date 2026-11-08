/** Intl-based formatting per PRD 12.13 (dates/numbers in the current locale). */

const INTL_LOCALES: Record<string, string> = { en: "en-US", zh: "zh-CN" };

function intlLocale(locale: string): string {
  return INTL_LOCALES[locale] ?? locale;
}

/** Extract a fixed-offset timeZone name like "Etc/GMT-8" for +08:00. */
function fixedOffsetZone(dateStr: string): { timeZone: string; label: string } {
  const match = dateStr.match(/([+-])(\d{2}):(\d{2})$|Z$/);
  if (!match) return { timeZone: "UTC", label: "UTC" };
  if (match[0] === "Z") return { timeZone: "UTC", label: "UTC" };
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  // Etc zones invert the sign.
  const zone = `Etc/GMT${sign >= 0 ? "-" : "+"}${hours}${minutes ? `:${minutes}` : ""}`;
  const label = `UTC${sign >= 0 ? "+" : "-"}${String(hours).padStart(2, "0")}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
  return { timeZone: zone, label };
}

/** Absolute time in the current locale's format, with the source's timezone label (PRD 06.4). */
export function formatDateTime(dateStr: string, locale: string): string {
  try {
    const { timeZone, label } = fixedOffsetZone(dateStr);
    const formatted = new Intl.DateTimeFormat(intlLocale(locale), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(dateStr));
    return `${formatted} ${label}`;
  } catch {
    return dateStr;
  }
}

/** Date only, for "verified on" style stamps. */
export function formatDate(dateStr: string, locale?: string): string {
  try {
    const { timeZone } = fixedOffsetZone(dateStr);
    return new Intl.DateTimeFormat(intlLocale(locale ?? "en"), {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone,
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}
