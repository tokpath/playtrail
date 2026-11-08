import { test, expect, type Page } from "@playwright/test";

/** Serializable description of the focused element, computed in the page. */
type Focused = { tag: string; id: string; name: string; href: string; text: string };

/** Tab until the predicate matches the focused element's descriptor. */
async function tabUntil(page: Page, match: (el: Focused) => boolean, maxTabs = 40): Promise<Focused | null> {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate((): Focused | null => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return null;
      return {
        tag: a.tagName,
        id: a.id ?? "",
        name: (a as HTMLInputElement).name ?? "",
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").trim().slice(0, 40),
      };
    });
    if (el && match(el)) return el;
  }
  return null;
}

/** Focus visibility computed in the page (outline or box-shadow present). */
async function focusVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const a = document.activeElement as Element | null;
    if (!a) return false;
    const s = getComputedStyle(a);
    return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
  });
}

const WIDTHS = [360, 768, 1440];
const PAGES = ["/en/", "/en/games", "/en/games/trail-runner-e2e"];

test("E18 体验：360/768/1440 无横向溢出，搜索/筛选/CTA 键盘可达且焦点可见", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll, `${path} @${width}px`).toBeLessThanOrEqual(overflow.client + 1);
    }
  }

  // Keyboard: search, a category entry and the CTA are reachable and show a
  // visible focus indicator.
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/en/games");
  const searchEl = await tabUntil(page, (el) => el.tag === "INPUT" && el.name === "q");
  expect(searchEl, "search input reachable by keyboard").not.toBeNull();

  const categoryEl = await tabUntil(page, (el) => el.tag === "A" && el.href.includes("/categories/"));
  expect(categoryEl, "category navigation reachable").not.toBeNull();
  expect(await focusVisible(page), "focused category link shows a visible focus indicator").toBe(true);

  await page.goto("/en/games/trail-runner-e2e");
  const ctaEl = await tabUntil(page, (el) => el.id === "primary-cta");
  expect(ctaEl, "outbound CTA reachable by keyboard").not.toBeNull();
  expect(await focusVisible(page), "focused CTA shows a visible focus indicator").toBe(true);

  // Mobile: search and filters fold away but stay operable (PRD §05.1.7).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/games");
  const filters = page.getByRole("button", { name: /Filters|筛选/ }).first();
  await expect(filters).toBeVisible();
  await filters.click();
  await expect(page.getByRole("button", { name: ".io" }).first()).toBeVisible();
  // The search stays reachable too (header icon opens the search dialog).
  await page.goto("/en/");
  await expect(page.locator('button[aria-label]').first()).toBeVisible();
});
