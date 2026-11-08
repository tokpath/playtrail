import { test, expect } from "@playwright/test";

const ROWS: Array<[string, string | undefined, number, string]> = [
  ["/", "zh-CN,zh;q=0.9,en;q=0.8", 302, "/zh"],
  ["/", "fr-FR,fr;q=0.9,en;q=0.5", 302, "/en"],
  ["/", "ja", 302, "/en"],
  ["/", undefined, 302, "/en"],
  ["/", "!!!invalid", 302, "/en"],
  ["/games/vault-sprint-e2e", "zh-TW", 302, "/zh/games/vault-sprint-e2e"],
  ["/games?q=car&page=2", "en-US", 302, "/en/games?q=car&page=2"],
  ["/games/kite-field-e2e", "zh-CN", 302, "/zh/games/kite-field-e2e"],
];

test("E19 语言跳转：按 4.2 示例表逐行断言状态码与 Location", async ({ request }) => {
  for (const [path, acceptLanguage, status, location] of ROWS) {
    const res = await request.fetch(path, { maxRedirects: 0, headers: acceptLanguage ? { "Accept-Language": acceptLanguage } : {} });
    expect(res.status(), `${path} AL=${acceptLanguage}`).toBe(status);
    expect(res.headers()["location"], `${path} AL=${acceptLanguage}`).toBe(location);
    expect(res.headers()["vary"]).toContain("Accept-Language");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["set-cookie"]).toBeUndefined();
  }

  // Prefixed URLs are never rewritten by request headers.
  const direct = await request.fetch("/zh/games/bloxdhop-io", { maxRedirects: 0, headers: { "Accept-Language": "en-US" } });
  expect(direct.status()).toBe(200);
  expect(direct.headers()["location"]).toBeUndefined();
  expect(await direct.text()).toMatch(/在 CrazyGames 游玩|Bloxd\.io/);

  // Exempt prefixes never redirect.
  for (const path of ["/api/meta", "/admin/login", "/sitemap.xml"]) {
    const res = await request.fetch(path, { maxRedirects: 0, headers: { "Accept-Language": "zh-CN" } });
    expect(res.headers()["location"], path).toBeUndefined();
  }

  // Non-routable paths: real 404, no redirect first (PRD 4.2).
  expect((await request.fetch("/foo", { maxRedirects: 0, headers: { "Accept-Language": "zh-CN" } })).status()).toBe(404);
  expect((await request.fetch("/xx", { maxRedirects: 0, headers: { "Accept-Language": "zh-CN" } })).status()).toBe(404);

  // Two different Accept-Language values in sequence never share a cached
  // redirect (private, no-store computed per request).
  const zh = await request.fetch("/", { maxRedirects: 0, headers: { "Accept-Language": "zh-CN" } });
  const fr = await request.fetch("/", { maxRedirects: 0, headers: { "Accept-Language": "fr-FR,fr;q=0.9" } });
  expect(zh.headers()["location"]).toBe("/zh");
  expect(fr.headers()["location"]).toBe("/en");
});

test("E19 语言切换：/en 页面不被请求头改写，切换器到达同页目标语言", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "Accept-Language": "zh-CN" } });
  const page = await context.newPage();
  await page.goto("/en/games/bloxdhop-io");
  await expect(page.locator("#primary-cta")).toBeVisible(); // 200, English page, no re-redirect

  await page.locator("[data-lang-switcher] button").first().click();
  await page.locator("[data-lang-switcher]").getByRole("link", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/games\/bloxdhop-io/);
  await expect(page.locator("#primary-cta")).toBeVisible();

  // The en-only game has no zh page: the switch lands on the zh home.
  await page.goto("/en/games/kite-field-e2e");
  await expect(page.locator("#primary-cta")).toBeVisible();
  await page.locator("[data-lang-switcher] button").first().click();
  await page.locator("[data-lang-switcher]").getByRole("link", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/zh\/?$/);
  await context.close();
});
