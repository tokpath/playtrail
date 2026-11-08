import { test, expect } from "@playwright/test";
import { adminLogin, adminGet, collectEvents, countEvent, pick } from "../lib/api";

const CTA_URL = "https://www.crazygames.com/game/bloxity-io";

test("E06 正常出站：新标签打开精确白名单 URL、noopener、一次一个 outbound_click", async ({ page }, testInfo) => {
  // Intercept the outbound navigation so the evidence is repeatable and no
  // real third-party page is loaded (PRD 13, table note).
  await page.route("https://www.crazygames.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>intercepted</title>" }));

  const isWebkit = testInfo.project.name.startsWith("webkit");
  // WebKit automation does not surface sendBeacon requests; verify the event
  // server-side through the admin stats delta instead.
  const events = collectEvents(page);
  await page.goto("/en/games/bloxity-io");
  if (!isWebkit) await expect.poll(() => countEvent(events, "game_view")).toBe(1);

  const cta = page.locator("#primary-cta");
  await expect(cta).toHaveAttribute("href", CTA_URL);
  await expect(cta).toHaveAttribute("target", "_blank");
  await expect(cta).toHaveAttribute("rel", "noopener noreferrer");

  let outboundBefore = 0;
  if (isWebkit) {
    await adminLogin(page.request);
    const detail = await (await page.request.get("/api/games/bloxity-io?locale=en")).json();
    const gameId = pick<string>(detail, "id", "ID");
    const stats = await adminGet(page.request, "/stats?from=2026-11-01&to=2026-11-30&gameId=" + gameId + "&locale=en");
    outboundBefore = pick<number>(pick<any>(stats, "totals") ?? {}, "outboundClicks");
  }

  // Mouse activation opens the exact whitelisted URL in a new tab; this page
  // stays where it is.
  const popupPromise = page.waitForEvent("popup");
  await cta.click();
  const popup = await popupPromise;
  expect(popup.url()).toBe(CTA_URL);
  await popup.close();
  if (!isWebkit) {
    await expect.poll(() => countEvent(events, "outbound_click")).toBe(1);
    await expect.poll(() => countEvent(events, "game_view")).toBe(1);
  } else {
    await expect.poll(async () => {
      const stats = await adminGet(page.request, "/stats?from=2026-11-01&to=2026-11-30&gameId=" + pick<string>(await (await page.request.get("/api/games/bloxity-io?locale=en")).json(), "id", "ID") + "&locale=en");
      return pick<number>(pick<any>(stats, "totals") ?? {}, "outboundClicks");
    }, { timeout: 30_000, intervals: [2_000] }).toBe(outboundBefore + 1);
  }

  // Keyboard activation is counted the same way, once per activation.
  const popup2 = page.waitForEvent("popup");
  await cta.focus();
  await page.keyboard.press("Enter");
  const popupB = await popup2;
  expect(popupB.url()).toBe(CTA_URL);
  await popupB.close();
  if (!isWebkit) await expect.poll(() => countEvent(events, "outbound_click")).toBe(2);
});
