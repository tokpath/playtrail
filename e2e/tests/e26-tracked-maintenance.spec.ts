import { test, expect } from "@playwright/test";
import { adminLogin, adminFindGame, adminGet, adminPost, pick } from "../lib/api";
import { crawl } from "../lib/crawl";
import { control } from "../lib/fake";

const CASES: Array<[string, any, string]> = [
  ["bloxdhop-io", { type: "not_found" }, "suspect"],
  ["bloxity-io", { type: "unpublished" }, "suspect"],
];
const RENAMED = ["messy-mart", { type: "renamed", newName: "Messy Mart Renamed E2E" }] as const;
const ERRORED = ["steal-a-eggs", { type: "server_error" }] as const;

test("E26 自动维护与变更：404/未发布→suspect 停 CTA 不下架、改名→待复核、503→状态不变", async ({ request }) => {
  test.setTimeout(300_000);
  await adminLogin(request);

  // All four published fixture games start with valid links.
  for (const slug of ["bloxdhop-io", "bloxity-io", "messy-mart", "steal-a-eggs"]) {
    const row = await adminFindGame(request, slug);
    if (pick<string>(row, "linkStatus") !== "valid") {
      const res = await adminPost(request, `/games/${pick<string>(row, "id", "ID")}/link-check`, { status: "valid", note: "e2e reset" });
      expect(res.ok()).toBeTruthy();
    }
  }

  await control({
    games: Object.fromEntries([
      ...CASES.map(([slug, sc]) => [slug, sc]),
      [RENAMED[0], RENAMED[1]],
      [ERRORED[0], ERRORED[1]],
    ]),
  });
  expect(crawl("tracked", 300_000).status).toBe(0);

  // 404 and non-PUBLISHED: suspect, CTA disabled immediately, never auto-unlisted.
  for (const [slug] of CASES) {
    const detail = await adminGet(request, `/games/${pick<string>(await adminFindGame(request, slug), "id", "ID")}`);
    expect(pick<string>(detail, "linkStatus"), slug).toBe("suspect");
    expect(pick<string>(detail, "status")).toBe("published");
    const pub = await (await request.get(`/api/games/${slug}?locale=en`)).json();
    expect(pick<boolean>(pub, "outboundAllowed")).toBe(false);
  }

  // Renamed: a pending change for review, public content untouched.
  const messy = await adminFindGame(request, RENAMED[0]);
  const messyId = pick<string>(messy, "id", "ID");
  const messyDetail = await adminGet(request, `/games/${messyId}`);
  expect(pick<string>(messyDetail, "linkStatus")).toBe("valid");
  const pubMessy = await (await request.get(`/api/games/${RENAMED[0]}?locale=en`)).json();
  expect(pick<string>(pubMessy, "name")).toBe("Messy Mart");
  const changes = await adminGet(request, "/source-changes");
  const pending = (pick<any[]>(changes, "items") ?? []).filter(
    (c) => pick<string>(c, "gameId", "game_id") === messyId && pick<string>(c, "state") === "pending",
  );
  expect(pending.length).toBeGreaterThan(0);
  expect(pending.map((c) => pick<string>(c, "field"))).toContain("name");

  // 503: fetch failure does not touch the link status (PRD 22.7 row 3).
  const steal = await adminGet(request, `/games/${pick<string>(await adminFindGame(request, ERRORED[0]), "id", "ID")}`);
  expect(pick<string>(steal, "linkStatus")).toBe("valid");

  // Restore: reset the fake server, revalidate the two suspects, drop the
  // pending change so later scenarios start clean.
  await control({});
  for (const slug of ["bloxdhop-io", "bloxity-io"]) {
    const row = await adminFindGame(request, slug);
    const res = await adminPost(request, `/games/${pick<string>(row, "id", "ID")}/link-check`, { status: "valid", note: "e2e restore" });
    expect(res.ok()).toBeTruthy();
  }
  for (const change of pending) {
    await adminPost(request, `/source-changes/${pick<string>(change, "id", "ID")}/resolve`, { action: "ignore" });
  }
});
