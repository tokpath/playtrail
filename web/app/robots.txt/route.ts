const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";

export async function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /_internal
Disallow: /api

Sitemap: ${PUBLIC_BASE_URL}/sitemap.xml
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
