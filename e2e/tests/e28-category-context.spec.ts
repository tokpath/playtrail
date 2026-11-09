import { test, expect } from "@playwright/test";

// Exercise actual form submissions and controls, not synthetic URL changes.
test("E28 category controls preserve path, filters and history", async ({ page }) => {
  await page.goto("/en/categories/io");
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    await page.getByRole("button", { name: "Filters", exact: false }).first().click();
  }
  await page.getByRole("button", { name: "Building", exact: true }).first().click();
  await expect(page).toHaveURL(/\/en\/categories\/io\?tag=building$/);
  await page.getByRole("button", { name: "Recently added", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/categories\/io\?tag=building&sort=newest$/);
  const search = page.locator('main form[role="search"] input[name="q"]');
  await search.fill("Bloxd");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/en\/categories\/io\?.*q=Bloxd/);
  expect(new URL(page.url()).searchParams.get("tag")).toBe("building");
  expect(new URL(page.url()).searchParams.get("sort")).toBe("newest");
  await search.fill("");
  await search.press("Enter");
  await expect(page).not.toHaveURL(/q=/);
  await page.goBack();
  await expect(search).toHaveValue("Bloxd");
  await page.getByRole("button", { name: "Clear all", exact: true }).last().click();
  await expect(page).toHaveURL(/\/en\/categories\/io$/);
});

test("E28 all-games search preserves category, tag and sort and resets page", async ({ page }) => {
  await page.goto("/en/games?category=io&tag=building&sort=newest&page=2");
  const search = page.locator('main form[role="search"] input[name="q"]');
  await search.fill("Bloxd");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=Bloxd/);
  const params = new URL(page.url()).searchParams;
  expect(params.get("category")).toBe("io");
  expect(params.get("tag")).toBe("building");
  expect(params.get("sort")).toBe("newest");
  expect(params.has("page")).toBe(false);
});
