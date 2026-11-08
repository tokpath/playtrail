import { test, expect } from "@playwright/test";

test("E04 搜索空态：0 结果、清除入口、noindex；未知类别 404，空类别 200 noindex", async ({ page, request }) => {
  // Non-matching keyword: explicit empty state with a clear entry, no similar
  // games invented, and the page is noindex.
  await page.goto("/en/games?q=zzz-no-such-game-e2e");
  await expect(page.getByText(/No games on this trail|未找到/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Clear|清除/ }).first()).toBeVisible();
  const apiEmpty = await (await request.get("/api/games?locale=en&q=zzz-no-such-game-e2e")).json();
  expect(apiEmpty.total).toBe(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // Unknown category: a real 404.
  const missing = await request.get("/en/categories/definitely-not-a-category-e2e");
  expect(missing.status()).toBe(404);

  // Known but empty category: 200, explainable empty page, noindex, and it is
  // absent from the public category list.
  const res = await page.goto("/en/categories/trivia");
  expect(res?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const categories = await (await request.get("/api/categories?locale=en")).json();
  expect((categories.items ?? []).map((c: any) => c.slug ?? c.Slug)).not.toContain("trivia");
});
