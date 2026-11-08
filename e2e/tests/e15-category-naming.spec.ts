import { test, expect } from "@playwright/test";
import { pick } from "../lib/api";

test("E15 分类标签与名义：.io 名字不覆盖主类别，tag 与 category 互不混写", async ({ page, request }) => {
  const growden = await (await request.get("/api/games/growden-io?locale=en")).json();
  expect(pick<string>(growden.primaryCategory, "slug")).toBe("sim");
  const bloxd = await (await request.get("/api/games/bloxdhop-io?locale=en")).json();
  expect(pick<string>(bloxd.primaryCategory, "slug")).toBe("io");

  // Category filters follow the stored primary category, not the name.
  const sim = await (await request.get("/api/games?locale=en&category=sim")).json();
  const simSlugs = (pick<any[]>(sim, "items") ?? []).map((g: any) => pick<string>(g, "slug"));
  expect(simSlugs).toContain("growden-io");
  expect(simSlugs).not.toContain("bloxdhop-io");

  // Tag and category are orthogonal AND filters.
  const both = await (await request.get("/api/games?locale=en&category=io&tag=building")).json();
  const bothSlugs = (pick<any[]>(both, "items") ?? []).map((g: any) => pick<string>(g, "slug"));
  expect(bothSlugs).toEqual(["bloxdhop-io"]);

  const io = await (await request.get("/api/games?locale=en&category=io")).json();
  const ioSlugs = (pick<any[]>(io, "items") ?? []).map((g: any) => pick<string>(g, "slug"));
  expect(ioSlugs).toContain("bloxdhop-io");
  expect(ioSlugs).not.toContain("growden-io");

  // The category landing page shows the sim game under 模拟/Simulation.
  await page.goto("/en/categories/sim");
  await expect(page.getByRole("heading", { name: /Growden\.io/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Bloxd\.io/ })).toHaveCount(0);
});
