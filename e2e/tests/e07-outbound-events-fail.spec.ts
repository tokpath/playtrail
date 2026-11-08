import { test, expect } from "@playwright/test";
import { collectEvents, countEvent } from "../lib/api";

const CTA_URL = "https://www.crazygames.com/game/bloxity-io";

test("E07 统计失败仍离站：离线/超时/429 都不阻断导航、不循环重试", async ({ page }, testInfo) => {
  await page.route("https://www.crazygames.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>intercepted</title>" }));

  // WebKit automation does not surface sendBeacon requests, so the request
  // level counts are only observable on Chromium; navigation behaviour is
  // asserted on every engine.
  const isWebkit = testInfo.project.name.startsWith("webkit");
  const events = collectEvents(page);
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  // The events endpoint fails in three ways; navigation must never wait for
  // it, never be blocked, and never retry into duplicate events.
  let mode: "abort" | "timeout" | "429" = "abort";
  await page.route("**/api/events", async (route) => {
    if (mode === "abort") return route.abort("connectionrefused");
    if (mode === "timeout") {
      await new Promise((r) => setTimeout(r, 8000));
      return route.fulfill({ status: 500, body: "late" });
    }
    return route.fulfill({ status: 429, body: '{"code":"RATE_LIMITED"}' });
  });

  for (const m of ["abort", "timeout", "429"] as const) {
    mode = m;
    await page.goto("/en/games/bloxity-io");
    if (!isWebkit) await expect.poll(() => countEvent(events, "game_view")).toBeGreaterThanOrEqual(1);
    const before = countEvent(events, "game_view") + countEvent(events, "outbound_click");

    const popupPromise = page.waitForEvent("popup");
    await page.locator("#primary-cta").click();
    const popup = await popupPromise;
    expect(popup.url()).toBe(CTA_URL);
    await popup.close();

    // Exactly one new event (the outbound_click) was attempted — no retry
    // loop — and nothing blocked the visitor.
    await page.waitForTimeout(500);
    if (!isWebkit) {
      const after = countEvent(events, "game_view") + countEvent(events, "outbound_click");
      expect(after - before).toBe(1);
      expect(countEvent(events, "outbound_click")).toBeGreaterThan(0);
    }
    expect(dialogs).toHaveLength(0);
  }
});
