import type { NextRequest } from "next/server";
import { getSitemap } from "@/lib/api/server";
import { LOCALES } from "@/lib/i18n/routing";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

/** Per-locale sitemap (PRD 12.6): published games, live categories, static
 * pages; entries carry xhtml:link alternates for the other live locales.
 * Reached via rewrite of /sitemap-{locale}.xml, where {file} is "en.xml". */
export async function GET(request: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const locale = (await ctx.params).file.replace(/\.xml$/, "");
  if (!LOCALES.includes(locale)) {
    return new Response("Unknown locale", { status: 400 });
  }

  let payload: Awaited<ReturnType<typeof getSitemap>> | null = null;
  try {
    payload = await getSitemap(locale);
  } catch {
    payload = null;
  }

  const staticPages = ["", "hot", "about", "privacy", "copyright"];
  const entries: { path: string; updatedAt?: string; locales: string[] }[] = [
    ...staticPages.map((page) => ({ path: page, locales: LOCALES })),
  ];
  if (payload) {
    for (const category of payload.categories) {
      entries.push({ path: `categories/${category.slug}`, locales: category.locales });
    }
    for (const game of payload.games) {
      entries.push({ path: `games/${game.slug}`, updatedAt: game.updatedAt, locales: game.locales });
    }
  }

  const urls = entries
    .filter((entry) => entry.locales.includes(locale))
    .map((entry) => {
      const loc = `${PUBLIC_BASE_URL}/${locale}${entry.path ? `/${entry.path}` : ""}`;
      const alternates = entry.locales
        .map(
          (l) =>
            `<xhtml:link rel="alternate" hreflang="${l === "zh" ? "zh-Hans" : l}" href="${PUBLIC_BASE_URL}/${l}${entry.path ? `/${entry.path}` : ""}"/>`,
        )
        .join("");
      const lastmod = entry.updatedAt ? `<lastmod>${entry.updatedAt}</lastmod>` : "";
      return `  <url><loc>${loc}</loc>${lastmod}${alternates}</url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

export const revalidate = 30;
