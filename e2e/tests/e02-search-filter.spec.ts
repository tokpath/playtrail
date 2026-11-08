import { test, expect, type Page } from "@playwright/test";

/**
 * E02 搜索与组合筛选 (PRD §05): mixed-case keyword AND category AND tag, URL
 * keeps state, clearing restores the default, browser back restores filters
 * and page. Works on the desktop filter rail and the mobile drawer.
 */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;

async function search(page: Page, term: string) {
  if (!isMobile(page)) {
    await page.locator('form[role="search"] input[name="q"]').first().fill(term);
    await page.locator('form[role="search"] input[name="q"]').first().press("Enter");
  } else {
    // Mobile: reach the same result through the URL (search icon flow is
    // covered by E18's keyboard checks); the list state is identical.
    await page.goto(`/en/games?q=${encodeURIComponent(term)}`);
  }
}

async function selectFilter(page: Page, option: string) {
  if (!isMobile(page)) {
    await page.getByRole("button", { name: option }).first().click();
  } else {
    await page.getByRole("button", { name: /Filters|筛选/ }).first().click();
    await page.getByRole("button", { name: option }).first().click();
  }
}

test("E02 搜索与组合筛选：AND 匹配、URL 同步、清除与后退", async ({ page }) => {
  await page.goto("/en/games");
  await search(page, "BLOXity"); // mixed case, substring match on the official name
  await expect(page).toHaveURL(/q=BLOXity/);
  await expect(page.getByRole("heading", { name: /Bloxity\.io/ })).toBeVisible();

  await selectFilter(page, ".io"); // category
  await expect(page).toHaveURL(/q=BLOXity&category=io/);
  await selectFilter(page, "PvP"); // tag — AND-combined, still exactly one game
  await expect(page).toHaveURL(/q=BLOXity&category=io&tag=pvp/);
  await expect(page.getByRole("heading", { name: /Bloxity\.io/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Bloxd\.io/ })).toHaveCount(0);

  if (!isMobile(page)) {
    await page.locator("aside").getByRole("button", { name: /Clear all|Clear filters|清除/ }).last().click();
  } else {
    await page.getByRole("button", { name: /Filters|筛选/ }).first().click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: /Clear all|Clear filters|清除/ }).last().click();
  }
  await expect(page).toHaveURL(/\/en\/games$/);
  await expect(page.locator("main [data-list-total], main")).toContainText("30");

  // Browser back restores the previous conditions (PRD §05.6).
  await page.goBack();
  await expect(page).toHaveURL(/q=BLOXity&category=io&tag=pvp/);
  await expect(page.getByRole("heading", { name: /Bloxity\.io/ })).toBeVisible();

  // Selecting a filter resets to page 1 (page state removed from the URL).
  // A fresh renderer page: this sequence of history navigations crashes the
  // WebKit page process, and the steps do not depend on the previous page.
  const fresh = await page.context().newPage();
  await fresh.setViewportSize(page.viewportSize() ?? { width: 1440, height: 900 });
  await fresh.goto("/en/games?page=2");
  await expect(fresh).toHaveURL(/page=2/);
  await selectFilter(fresh, ".io");
  await expect(fresh).not.toHaveURL(/page=/);
  await fresh.close();
});
