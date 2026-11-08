import { test, expect } from "@playwright/test";

function meta(html: string, attr: "property" | "name", key: string): string | null {
  const m = html.match(new RegExp(`<meta[^>]*${attr}="${key}"[^>]*content="([^"]*)"`, "i"));
  return m ? m[1] : null;
}
function hreflangs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']alternate["']/i.test(m[0])) continue;
    const h = m[0].match(/hreflang=["']([^"']+)["']/i);
    if (h) out.push(h[1]);
  }
  return out;
}

test("E17 SEO 与 404：canonical、hreflang 双向、noindex、sitemap、真实 404", async ({ request }) => {
  const web = "http://127.0.0.1:3100";

  const home = await (await request.get("/en/")).text();
  expect(meta(home, "property", "og:url")).toBe(`${web}/en`);
  expect(meta(home, "name", "robots") ?? "").not.toContain("noindex");
  expect(home).toMatch(/<html[^>]*lang="en"/);
  // hreflang lists the live locales plus x-default, and zh mirrors it.
  expect(hreflangs(home)).toEqual(expect.arrayContaining(["en", "zh-Hans", "x-default"]));
  const zhHome = await (await request.get("/zh/")).text();
  expect(zhHome).toMatch(/<html[^>]*lang="zh-Hans"/);
  expect(hreflangs(zhHome)).toEqual(expect.arrayContaining(["en", "zh-Hans", "x-default"]));

  const detail = await (await request.get("/en/games/bloxdhop-io")).text();
  expect(meta(detail, "property", "og:url")).toBe(`${web}/en/games/bloxdhop-io`);
  expect(detail).toContain(`rel="canonical" href="${web}/en/games/bloxdhop-io"`);
  expect(hreflangs(detail)).toEqual(expect.arrayContaining(["en", "zh-Hans", "x-default"]));

  // Search/filter pages and empty categories are noindex; content pages are not.
  const search = await (await request.get("/en/games?q=zzz-e2e")).text();
  expect(meta(search, "name", "robots") ?? "").toContain("noindex");
  const category = await (await request.get("/en/categories/io")).text();
  expect(meta(category, "name", "robots") ?? "").not.toContain("noindex");

  // Drafts and unknown paths return real 404s, never soft-200s.
  expect((await request.get("/en/games/e2e-draft-alpha-e2e")).status()).toBe(404);
  expect((await request.get("/en/definitely-not-a-path-e2e")).status()).toBe(404);
  expect((await request.get("/zh/definitely-not-a-path-e2e")).status()).toBe(404);

  // Sitemaps: index splits per locale; only published, indexable pages.
  const index = await (await request.get("/sitemap.xml")).text();
  expect(index).toContain("sitemap-en.xml");
  expect(index).toContain("sitemap-zh.xml");
  const en = await (await request.get("/sitemap-en.xml")).text();
  const zh = await (await request.get("/sitemap-zh.xml")).text();
  expect(en).toContain("/en/games/bloxdhop-io");
  for (const banned of ["e2e-draft-alpha-e2e", "orbit-keeper-e2e", "e2e-import-01"]) {
    expect(en).not.toContain(banned);
    expect(zh).not.toContain(banned);
  }
  expect(zh).not.toContain("pendo-puzzle-e2e"); // en-only game at this point
  expect(await (await request.get("/robots.txt")).status()).toBe(200);
});
