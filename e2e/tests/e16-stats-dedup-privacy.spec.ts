import { test, expect } from "@playwright/test";
import { adminLogin, adminGet, setClock, resetClock, collectEvents, countEvent, pick } from "../lib/api";

const GAME = "pendo-puzzle-e2e"; // browser scenarios never open this detail page

function event(eventId: string, name: string, gameId: string, placement: string) {
  return {
    eventId, eventName: name, gameId,
    pageType: "detail",
    pagePath: `/en/games/${GAME}`,
    locale: "en",
    occurredAt: new Date().toISOString(),
    placement,
    entrySource: "direct_or_unknown",
  };
}

test.afterEach(async ({ request }) => resetClock(request));

test("E16 统计去重与隐私：eventId 去重、跨日界按 receivedAt 归日、DNT/GPC 不发事件仍可离站", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const detail = await (await request.get(`/api/games/${GAME}?locale=en`)).json();
  const gameId = pick<string>(detail, "id", "ID");

  // Day 1, 23:55 ops time: one event submitted twice (transport retry shape).
  await setClock(request, "2026-11-09T23:55:00+08:00");
  const ev1 = event(crypto.randomUUID(), "game_view", gameId, "detail_page");
  expect((await request.post("/api/events", { data: ev1 })).status()).toBe(202);
  expect((await request.post("/api/events", { data: ev1 })).status()).toBe(202);

  // Day 2, 00:05 ops time: a new event — and the duplicated eventId again.
  await setClock(request, "2026-11-10T00:05:00+08:00");
  const ev2 = event(crypto.randomUUID(), "outbound_click", gameId, "detail_primary");
  expect((await request.post("/api/events", { data: ev2 })).status()).toBe(202);
  expect((await request.post("/api/events", { data: ev1 })).status()).toBe(202);

  // The report aggregates by receivedAt in the ops timezone: one view on
  // 2026-11-09, one click on 2026-11-10, no double counting.
  await adminLogin(request);
  const stats = await adminGet(request, `/stats?from=2026-11-09&to=2026-11-10&gameId=${gameId}&locale=en`);
  const days = pick<any[]>(stats, "days") ?? [];
  const day = (d: string) => days.find((x) => pick<string>(x, "day") === d) ?? {};
  expect(pick<number>(day("2026-11-09"), "gameViews")).toBe(1);
  expect(pick<number>(day("2026-11-09"), "outboundClicks")).toBe(0);
  expect(pick<number>(day("2026-11-10"), "gameViews")).toBe(0);
  expect(pick<number>(day("2026-11-10"), "outboundClicks")).toBe(1);

  // DNT + GPC: no product events are sent, browsing and outbound keep working.
  const context = await browser.newContext({ extraHTTPHeaders: { DNT: "1", "Sec-GPC": "1" } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true, configurable: true });
  });
  await context.route("https://www.crazygames.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>intercepted</title>" }));
  const dntPage = await context.newPage();
  const events = collectEvents(dntPage);
  await dntPage.goto(`/en/games/${GAME}`);
  await expect(dntPage.locator("#primary-cta")).toBeVisible();
  await expect(dntPage.getByRole("heading", { name: /Pendo Puzzle E2E/ })).toBeVisible();
  const popup = dntPage.waitForEvent("popup");
  await dntPage.locator("#primary-cta").click();
  expect((await popup).url()).toBe("https://www.crazygames.com/game/pendo-puzzle-e2e");
  await dntPage.waitForTimeout(1000);
  expect(events).toHaveLength(0);
  await context.close();
});
