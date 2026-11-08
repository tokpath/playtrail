import { LOCALES } from "@/lib/i18n/routing";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

/** Sitemap index: one sitemap per supported locale (PRD 12.6). */
export async function GET() {
  const entries = LOCALES.map((locale) => `  <sitemap><loc>${PUBLIC_BASE_URL}/sitemap-${locale}.xml</loc></sitemap>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

export const revalidate = 30;
