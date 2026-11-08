import { test, expect } from "@playwright/test";
import { pick } from "../lib/api";

const SLUG = "bloxdhop-io";

test("E21 搜索不跨语言：zh 别名命中、en 不命中，官方英文名两种语言都可搜到", async ({ page, request }) => {
  // The zh alias "方块世界" matches in zh…
  const zh = await (await request.get("/api/games?locale=zh&q=%E6%96%B9%E5%9D%97")).json();
  expect(pick<number>(zh, "total")).toBe(1);
  expect(pick<string>((pick<any[]>(zh, "items") ?? [])[0], "slug")).toBe(SLUG);
  await page.goto("/zh/games?q=%E6%96%B9%E5%9D%97");
  await expect(page.getByRole("heading", { name: /Bloxd\.io/ })).toBeVisible();

  // …but the same query is empty in en (no cross-language matching).
  const en = await (await request.get("/api/games?locale=en&q=%E6%96%B9%E5%9D%97")).json();
  expect(pick<number>(en, "total")).toBe(0);
  await page.goto("/en/games?q=%E6%96%B9%E5%9D%97");
  await expect(page.getByText(/No games on this trail|未找到/)).toBeVisible();

  // The official English name finds the game in both locales.
  for (const locale of ["en", "zh"]) {
    const res = await (await request.get(`/api/games?locale=${locale}&q=Bloxd.io`)).json();
    expect(pick<number>(res, "total"), locale).toBe(1);
    expect(pick<string>((pick<any[]>(res, "items") ?? [])[0], "slug")).toBe(SLUG);
  }
});
