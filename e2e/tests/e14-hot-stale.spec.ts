import { test, expect } from "@playwright/test";
import { adminLogin, adminGet, adminPost, setClock, resetClock, pick } from "../lib/api";

const T0 = "2026-11-09T12:00:00+08:00";

test.afterEach(async ({ request }) => resetClock(request));

test("E14 热门时效：48 小时后首页隐藏、/hot 历史标识、原始位置保留", async ({ page, request }) => {
  test.setTimeout(180_000);
  await adminLogin(request);
  await setClock(request, T0);

  // A fixed snapshot: position 2 maps to an unknown source slug and must be
  // dropped without renumbering the rest.
  const created = await adminPost(request, "/hot-snapshots", {
    sourceUrl: "https://www.crazygames.com/hot",
    sourceFetchedAt: T0,
    observedRegion: "TW",
    definition: "E2E fixture snapshot",
    cacheNote: "",
    items: [
      { position: 1, sourceSlug: "bloxdhop-io" },
      { position: 2, sourceSlug: "space-invaders" },
      { position: 3, sourceSlug: "bloxity-io" },
      { position: 4, sourceSlug: "messy-mart" },
      { position: 5, sourceSlug: "steal-a-eggs" },
    ],
  });
  expect(created.ok()).toBeTruthy();
  const snapshots = await adminGet(request, "/hot-snapshots");
  const batch = (pick<any[]>(snapshots, "snapshots", "items") ?? []).at(-1);
  const id = pick<string>(batch, "id", "ID");
  const reviewed = await adminPost(request, `/hot-snapshots/${id}/review`, { decision: "approved" });
  expect(reviewed.ok()).toBeTruthy();

  // Fresh snapshot: the home hot module shows the mapped items only. The web
  // page cache is invalidated by the review action; allow its short TTL.
  await expect
    .poll(async () => pick<any>(await (await request.get("/api/home?locale=en")).json(), "hot"), {
      timeout: 40_000,
      intervals: [2_000],
    })
    .not.toBeNull();
  let home = await (await request.get("/api/home?locale=en")).json();
  const positions = (pick<any[]>(home.hot, "items") ?? []).map((i: any) => pick<number>(i, "position"));
  expect(positions).toEqual([1, 3, 4, 5]);
  await expect.poll(async () => {
    await page.goto("/en/");
    return await page.getByRole("heading", { name: /hot snapshot/i }).count();
  }, { timeout: 60_000, intervals: [3_000] }).toBeGreaterThan(0);

  // 48 hours later: home hides the module, /hot keeps the historical banner
  // and the original positions; editorial picks are unaffected.
  await setClock(request, "2026-11-11T12:30:00+08:00");
  await expect
    .poll(async () => pick<any>(await (await request.get("/api/home?locale=en")).json(), "hot"), {
      timeout: 40_000,
      intervals: [2_000],
    })
    .toBeNull();
  home = await (await request.get("/api/home?locale=en")).json();
  expect((pick<any[]>(home, "featured") ?? []).length).toBeGreaterThan(0);

  const hot = await (await request.get("/api/hot?locale=en")).json();
  expect(pick<boolean>(hot.snapshot, "stale")).toBe(true);
  expect((pick<any[]>(hot.snapshot, "items") ?? []).map((i: any) => pick<number>(i, "position"))).toEqual([1, 3, 4, 5]);

  await expect.poll(async () => {
    await page.goto("/en/hot");
    return await page.getByText(/Historical snapshot|已超过 48 小时/).count();
  }, { timeout: 60_000, intervals: [3_000] }).toBeGreaterThan(0);
  await expect.poll(async () => {
    await page.goto("/en/");
    return await page.getByRole("heading", { name: /hot snapshot/i }).count();
  }, { timeout: 60_000, intervals: [3_000] }).toBe(0);
  await expect(page.getByRole("heading", { name: /Today|featured|精选/ }).first()).toBeVisible();
});
