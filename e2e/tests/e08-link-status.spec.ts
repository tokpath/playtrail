import { test, expect } from "@playwright/test";
import { collectEvents, countEvent, pick } from "../lib/api";

test("E08 已知失效/待核：CTA 禁用、不出站、公开 API 标记 link_unavailable", async ({ page }) => {
  for (const [slug, name] of [["vault-sprint-e2e", "Vault Sprint E2E"], ["e2e-bulk-01", "E2E Bulk 01"]]) {
    const events = collectEvents(page);
    await page.goto(`/en/games/${slug}`);
    await expect(page.getByText(name).first()).toBeVisible();

    // Disabled CTA with the standing explanation (PRD §05.1.3).
    await expect(page.getByText("External link unavailable")).toBeVisible();
    await expect(page.getByText(/external link is currently unavailable|play button is switched off/i).first()).toBeVisible();
    await expect(page.locator("#primary-cta")).toHaveCount(0);

    // Clicking the dead control neither navigates nor emits an event.
    const popup = page.waitForEvent("popup", { timeout: 1500 }).catch(() => null);
    await page.getByText("External link unavailable").click();
    expect(await popup).toBeNull();
    await page.waitForTimeout(300);
    expect(countEvent(events, "outbound_click")).toBe(0);

    const detail = await (await page.request.get(`/api/games/${slug}?locale=en`)).json();
    expect(pick<boolean>(detail, "outboundAllowed")).toBe(false);
    expect(pick<string>(detail, "outboundBlockedReason")).toBe("link_unavailable");
  }
});
