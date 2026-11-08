import type { Metadata } from "next";
import { htmlLang, ogLocale } from "@/lib/i18n/routing";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

/**
 * Shared metadata builder (PRD 12.4–12.6, PRD 20.2): canonical to the current
 * locale itself, hreflang only for locales where the page is live plus
 * x-default → the unprefixed path, OG/Twitter fields.
 */
export function pageMetadata({
  locale,
  liveLocales,
  path,
  title,
  description,
  noindex = false,
  ogImage,
  ogType = "website",
}: {
  locale: string;
  liveLocales: string[];
  /** Path with locale prefix, e.g. "/en/games/foo". */
  path: string;
  title: string;
  description: string;
  noindex?: boolean;
  /** Absolute or site-relative URL of the OG image, when not the default. */
  ogImage?: string | null;
  ogType?: "website" | "article";
}): Metadata {
  const canonical = `${PUBLIC_BASE_URL}${path}`;
  const rest = path.split("/").slice(2).join("/");
  const localized = (l: string) => `${PUBLIC_BASE_URL}/${l}${rest ? `/${rest}` : ""}`;

  const languages: Record<string, string> = {};
  for (const l of liveLocales) {
    languages[htmlLang(l)] = localized(l);
  }
  // x-default → the unprefixed path, which the proxy resolves per PRD 4.2.
  languages["x-default"] = `${PUBLIC_BASE_URL}/${rest}`;

  const ogImages = ogImage ? [{ url: new URL(ogImage, PUBLIC_BASE_URL).toString() }] : undefined;

  return {
    title,
    description,
    alternates: { canonical, languages },
    robots: noindex || liveLocales.length === 0 || !liveLocales.includes(locale)
      ? { index: false, follow: true }
      : undefined,
    openGraph: {
      type: ogType,
      url: canonical,
      siteName: "PlayTrail",
      title,
      description,
      locale: ogLocale(locale),
      alternateLocale: liveLocales.filter((l) => l !== locale).map((l) => ogLocale(l)),
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImages,
    },
  };
}

export function absoluteUrl(path: string): string {
  return `${PUBLIC_BASE_URL}${path}`;
}
