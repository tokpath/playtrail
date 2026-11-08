import { test, expect } from "@playwright/test";
import { pick } from "../lib/api";

/**
 * E05 详情与无图: a game without verified controls, unknown device support and
 * a cover that fails to load (network intercepted) — the generated placeholder
 * keeps the 16:9 layout, and no invented ratings or device claims appear.
 */
test("E05 详情与无图：占位回退、布局不塌、待核实文案、无虚构评分", async ({ page }) => {
  await page.route("**/imgs.crazygames.com/**", (route) => route.abort());
  await page.route("**/media/**", (route) => route.abort());

  await page.goto("/en/games/deep-core-e2e");
  await expect(page.getByText("Controls not yet verified")).toBeVisible();
  await expect(page.getByText("Device support unconfirmed")).toBeVisible();

  // No fabricated quality signals.
  await expect(page.getByText(/rating|★/i)).toHaveCount(0);

  // The cover image request failed, but the placeholder keeps the 16:9 box.
  const cover = page.getByRole("img", { name: /Deep Core E2E/ }).first();
  const box = await cover.locator("..").boundingBox();
  expect(box).not.toBeNull();
  const ratio = box!.width / box!.height;
  expect(ratio).toBeGreaterThan(1.5);
  expect(ratio).toBeLessThan(1.85);

  // The detail API agrees: controls empty, device unknown, outbound allowed.
  const detail = await (await page.request.get("/api/games/deep-core-e2e?locale=en")).json();
  expect(pick<string>(detail, "controls")).toBe("");
  expect(pick<string>(detail, "deviceSupport")).toBe("unknown");
  expect(pick<boolean>(detail, "outboundAllowed")).toBe(true);
});
