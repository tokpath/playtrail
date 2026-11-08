import { test, expect } from "@playwright/test";
import { adminLogin, adminFindGame, adminGet, adminPost, pick } from "../lib/api";

const SLUG = "pendo-puzzle-e2e";

function hreflangs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']alternate["']/i.test(m[0])) continue;
    const h = m[0].match(/hreflang=["']([^"']+)["']/i);
    if (h) out.push(h[1]);
  }
  return out;
}

test("E20 按语言发布：en 200 / zh 404，审核 zh 再发布后 60 秒内双向可访问", async ({ request }) => {
  // Before: en lives, zh does not — in the API, the page, the list, the
  // search, the sitemap and hreflang.
  expect((await request.get(`/api/games/${SLUG}?locale=en`)).status()).toBe(200);
  expect((await request.get(`/api/games/${SLUG}?locale=zh`)).status()).toBe(404);
  expect((await request.get(`/en/games/${SLUG}`)).status()).toBe(200);
  expect((await request.get(`/zh/games/${SLUG}`)).status()).toBe(404);
  const zhSearch = await (await request.get("/api/games?locale=zh&q=pendo")).json();
  expect(pick<number>(zhSearch, "total")).toBe(0);
  const zhSitemap = await (await request.get("/sitemap-zh.xml")).text();
  expect(zhSitemap).not.toContain(SLUG);
  const enHtmlBefore = await (await request.get(`/en/games/${SLUG}`)).text();
  expect(hreflangs(enHtmlBefore)).not.toContain("zh-Hans");

  // Approve zh and publish only that locale.
  await adminLogin(request);
  const row = await adminFindGame(request, SLUG);
  const id = pick<string>(row, "id", "ID");
  const game = await adminGet(request, `/games/${id}`);
  // The fixture publishes pendo in en only; supply zh content, then review it.
  const patched = await request.patch(`/api/admin/games/${id}`, {
    data: {
      revisionVersion: pick<number>(game, "revisionVersion"),
      locales: { zh: { summary: "Pendo zh zh summary that is long enough for the twenty character minimum gate.", description: "Pendo zh description for the language publish scenario. It is fixture text written only to satisfy the zh locale gates during acceptance testing." } },
    },
  });
  expect(patched.status()).toBe(200);
  const patchedBody = await patched.json();
  const review = await adminPost(request, `/games/${id}/locales/zh/review`, {
    revisionVersion: pick<number>(patchedBody, "revisionVersion"),
    decision: "approved",
    confirmOriginal: true,
    confirmFactsVerified: true,
  });
  expect(review.ok()).toBeTruthy();
  const reviewed = await review.json();
  const published = await adminPost(request, `/games/${id}/publish`, {
    revisionVersion: pick<number>(reviewed, "revisionVersion"),
    locales: ["zh"],
  });
  expect(published.status()).toBe(200);

  // Within 60 seconds zh is reachable and the hreflang sets are mutual.
  await expect
    .poll(async () => (await request.get(`/api/games/${SLUG}?locale=zh`)).status(), { timeout: 60_000, intervals: [2_000] })
    .toBe(200);
  // The web serves stale-while-revalidate once; poll until the pages catch up.
  await expect.poll(async () => {
    const enHtml = await (await request.get(`/en/games/${SLUG}`)).text();
    return hreflangs(enHtml).includes("zh-Hans");
  }, { timeout: 60_000, intervals: [2_000] }).toBe(true);
  await expect.poll(async () => {
    const zhHtml = await (await request.get(`/zh/games/${SLUG}`)).text();
    const langs = hreflangs(zhHtml);
    return langs.includes("en") && langs.includes("zh-Hans");
  }, { timeout: 60_000, intervals: [2_000] }).toBe(true);
  const zhSearch2 = await (await request.get("/api/games?locale=zh&q=pendo")).json();
  expect(pick<number>(zhSearch2, "total")).toBe(1);
});
