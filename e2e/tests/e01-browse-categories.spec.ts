import { test, expect } from "@playwright/test";
import { adminLogin, adminGet, pick } from "../lib/api";

const DRAFTS = ["e2e-draft-alpha-e2e", "e2e-draft-beta-e2e"];
const UNLISTED = "orbit-keeper-e2e";
const EXPECTED_TOTAL = 30; // 31 seeded published minus the unlisted fixture game
const EMPTY_CATEGORY = "trivia"; // seeded catalog leaves exactly one category empty

test("E01 浏览与分类：公开列表只出现已发布数据，空类别不进导航", async ({ page, request }) => {
  // Public list across pages: every published fixture game, nothing else.
  const seen = new Set<string>();
  let total = -1;
  for (let p = 1; seen.size < 40 && p <= 5; p++) {
    const res = await request.get(`/api/games?locale=en&page=${p}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    total = pick<number>(body, "total");
    for (const item of pick<any[]>(body, "items") ?? []) seen.add(pick<string>(item, "slug"));
    if ((pick<any[]>(body, "items") ?? []).length === 0) break;
  }
  expect(total).toBe(EXPECTED_TOTAL);
  expect(seen.size).toBe(EXPECTED_TOTAL);
  for (const hidden of [...DRAFTS, UNLISTED]) expect(seen.has(hidden)).toBeFalsy();

  // The 15-category dictionary exists in full (admin view)…
  await adminLogin(request);
  const dict = await adminGet(request, "/categories");
  const slugs = (pick<any[]>(dict, "categories", "items") ?? []).map((c) => pick<string>(c, "slug"));
  expect(slugs).toHaveLength(15);

  // …but the public home navigation only lists categories with published games.
  await page.goto("/en/");
  await expect(page.locator('nav a[href^="/en/categories/"]')).toHaveCount(14);
  await expect(page.locator(`nav a[href="/en/categories/${EMPTY_CATEGORY}"]`)).toHaveCount(0);
  await expect(page.locator('nav a[href="/en/categories/io"]')).toHaveCount(1);

  // Drafts and the unlisted game never enter the sitemap either.
  const sitemap = await (await request.get("/api/sitemap?locale=en")).json();
  const sitemapSlugs = (pick<any[]>(sitemap, "games") ?? []).map((g: any) => pick<string>(g, "slug"));
  for (const hidden of [...DRAFTS, UNLISTED]) expect(sitemapSlugs).not.toContain(hidden);
});
