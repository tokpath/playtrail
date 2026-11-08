import { test, expect } from "@playwright/test";
import { adminLogin, adminGet, adminPost, adminPatch, setClock, resetClock, pick } from "../lib/api";
import { crawl } from "../lib/crawl";
import { control, fakeLog, clearFakeLog } from "../lib/fake";

test.afterEach(async ({ request }) => {
  await resetClock(request);
  await adminPatch(request, "/crawler", { enabled: true, hotAutoPublish: true }).catch(() => {});
  await control({});
});

test("E27 热门快照自动生成：映射已发布游戏、保留原位置、可关自动发布、停爬+48h 隐藏", async ({ request }) => {
  test.setTimeout(300_000);
  await adminLogin(request);
  await adminPatch(request, "/crawler", { enabled: true, hotAutoPublish: true });
  await control({});
  await clearFakeLog();

  // Auto-publish run: only the four published games map; original positions
  // (1 bloxdhop, 2 bloxity, 4 steal, 6 messy) survive unmapped neighbours.
  expect(crawl("hot").status).toBe(0);
  let hot = await (await request.get("/api/hot?locale=en")).json();
  const snapshot = pick<any>(hot, "snapshot");
  expect(snapshot).not.toBeNull();
  expect(pick<boolean>(snapshot, "stale")).toBe(false);
  // Exactly the four published games map; the snapshot keeps the page
  // positions (non-contiguous, no renumbering) and page order.
  const items = pick<any[]>(snapshot, "items") ?? [];
  expect(items.map((i) => pick<string>(pick<any>(i, "game"), "slug")).sort()).toEqual([
    "bloxdhop-io", "bloxity-io", "messy-mart", "steal-a-eggs",
  ]);
  const positions = items.map((i) => pick<number>(i, "position"));
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(positions).not.toEqual([1, 2, 3, 4]);
  let home = await (await request.get("/api/home?locale=en")).json();
  expect(pick<any>(home, "hot")).not.toBeNull();
  const autoId = pick<string>(snapshot, "snapshotId");

  // Auto-publish off: a new batch is created but stays pending review.
  await adminPatch(request, "/crawler", { hotAutoPublish: false });
  expect(crawl("hot").status).toBe(0);
  const snapshots = await adminGet(request, "/hot-snapshots");
  const newest = [...(pick<any[]>(snapshots, "snapshots", "items") ?? [])]
    .sort((a, b) => String(pick<any>(a, "createdAt", "created_at")).localeCompare(String(pick<any>(b, "createdAt", "created_at"))))
    .at(-1)!;
  expect(pick<string>(newest, "reviewState", "review_state")).toBe("pending");
  hot = await (await request.get("/api/hot?locale=en")).json();
  expect(pick<string>(pick<any>(hot, "snapshot"), "snapshotId")).toBe(autoId); // approved batch still shown

  // Pause the crawler: no requests at all.
  await adminPatch(request, "/crawler", { enabled: false });
  await clearFakeLog();
  const paused = crawl("hot");
  expect(paused.status).not.toBe(0);
  expect(paused.stderr).toMatch(/paused/i);
  expect(await fakeLog()).toHaveLength(0);

  // 48 hours after the last approved snapshot, home hides the module and
  // /hot reports stale.
  await setClock(request, "2026-11-12T00:00:00+08:00");
  home = await (await request.get("/api/home?locale=en")).json();
  expect(pick<any>(home, "hot")).toBeNull();
  hot = await (await request.get("/api/hot?locale=en")).json();
  expect(pick<boolean>(pick<any>(hot, "snapshot"), "stale")).toBe(true);
});
