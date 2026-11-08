import { test, expect } from "@playwright/test";
import { adminLogin, adminFindGame, pick } from "../lib/api";

test("E09 草稿与下架：404/410、无泄露、预览不缓存给访客", async ({ page, request }) => {
  // Drafts and unknown slugs: 404 from the API and the page.
  for (const slug of ["e2e-draft-alpha-e2e", "no-such-slug-e2e"]) {
    const res = await request.get(`/api/games/${slug}?locale=en`);
    expect(res.status()).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
    expect((await request.get(`/en/games/${slug}`)).status()).toBe(404);
  }

  // Unlisted: 410 from API and page, no CTA anywhere.
  const gone = await request.get("/api/games/orbit-keeper-e2e?locale=en");
  expect(gone.status()).toBe(410);
  expect((await gone.json()).code).toBe("GONE");
  const page410 = await page.goto("/en/games/orbit-keeper-e2e");
  expect(page410?.status()).toBe(410);
  await expect(page.getByText(/left the trail|已从本站下架/)).toBeVisible();
  await expect(page.locator("#primary-cta")).toHaveCount(0);

  // No leakage into the sitemap or unlisted-slug reporting is wrong either:
  // the unlisted slug IS reported (web proxy uses it for the 410).
  const sitemap = await (await request.get("/api/sitemap?locale=en")).json();
  const slugs = (sitemap.games ?? []).map((g: any) => g.slug ?? g.Slug);
  expect(slugs).not.toContain("e2e-draft-alpha-e2e");
  expect(slugs).not.toContain("orbit-keeper-e2e");

  // The admin preview of the draft is served no-store — never cached.
  await adminLogin(request);
  const draft = await adminFindGame(request, "e2e-draft-alpha-e2e");
  const preview = await request.get(`/api/admin/games/${draft.id ?? draft.ID}/preview?locale=en`);
  expect(preview.status()).toBe(200);
  expect(preview.headers()["cache-control"] ?? "").toContain("no-store");
});
