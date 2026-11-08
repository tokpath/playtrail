import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { matchLocale } from "@/lib/i18n/accept-language";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n/routing";

/**
 * PRD 4.2 (Accept-Language redirect for unprefixed public paths) and
 * PRD 5.1.4 (410 for unlisted slugs). No cookies, no IP geolocation.
 */

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:8081";
const CACHE_TTL_MS = 30_000;

type MetaCache = { liveLocales: string[]; defaultLocale: string; fetchedAt: number };
let metaCache: MetaCache | null = null;
let unlistedCache: { slugs: Set<string>; fetchedAt: number } | null = null;

async function getLiveLocales(): Promise<string[]> {
  if (metaCache && Date.now() - metaCache.fetchedAt < CACHE_TTL_MS) return metaCache.liveLocales;
  try {
    const res = await fetch(`${API_INTERNAL_URL}/api/meta`, { cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const meta = (await res.json()) as MetaCache;
    metaCache = { liveLocales: meta.liveLocales, defaultLocale: meta.defaultLocale, fetchedAt: Date.now() };
    return metaCache.liveLocales;
  } catch {
    // API unreachable: fall back to the configured default (PRD 4.2 / A4.4).
    return [];
  }
}

async function getUnlistedSlugs(): Promise<Set<string>> {
  if (unlistedCache && Date.now() - unlistedCache.fetchedAt < CACHE_TTL_MS) return unlistedCache.slugs;
  try {
    const res = await fetch(`${API_INTERNAL_URL}/api/unlisted-slugs`, { cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { slugs: string[] };
    unlistedCache = { slugs: new Set(body.slugs), fetchedAt: Date.now() };
  } catch {
    unlistedCache = { slugs: new Set(), fetchedAt: Date.now() };
  }
  return unlistedCache.slugs;
}

/** Unprefixed public paths that participate in the Accept-Language redirect. */
const PUBLIC_PATHS = ["/", "/games", "/hot", "/about", "/privacy", "/copyright"];

function isPublicUnprefixedPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // /games/{slug} and /categories/{slug}
  return /^\/(?:games|categories)\/[^/]+$/.test(pathname);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();

  // Prefixed locale segment? Never re-redirect based on headers (PRD 4.2).
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (first !== undefined && LOCALES.includes(first)) {
    return withGoneRewrite(request, first);
  }

  // Not a public path → render as-is; the app returns a real 404 (PRD 4.2).
  if (!isPublicUnprefixedPath(pathname)) return NextResponse.next();

  const liveLocales = await getLiveLocales();
  const candidates = liveLocales.length > 0 ? liveLocales : [DEFAULT_LOCALE];
  const locale = matchLocale(request.headers.get("accept-language"), candidates) ?? DEFAULT_LOCALE;

  const target = new URL(`/${locale}${pathname === "/" ? "" : pathname}`, request.url);
  target.search = request.nextUrl.search;
  const redirect = NextResponse.redirect(target, 302);
  redirect.headers.set("Vary", "Accept-Language");
  redirect.headers.set("Cache-Control", "private, no-store");
  return redirect;
}

/** Rewrite unlisted game details to the 410 route (A11). */
async function withGoneRewrite(request: NextRequest, locale: string): Promise<NextResponse> {
  const match = request.nextUrl.pathname.match(new RegExp(`^/${locale}/games/([^/]+)$`));
  if (!match) return NextResponse.next();
  const slug = match[1];
  const unlisted = await getUnlistedSlugs();
  if (!unlisted.has(slug)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/gone";
  url.search = `?locale=${locale}&slug=${encodeURIComponent(slug)}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!api|_next|_internal|admin|media|robots\\.txt|sitemap|favicon\\.ico|.*\\..*).*)"],
};
