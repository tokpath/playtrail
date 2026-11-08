import { test, expect } from "@playwright/test";
import { collectEvents, countEvent, pick } from "../lib/api";

// Deterministic per PRD 18.2 over the fixture: score desc → editorialOrder
// asc → id asc; the invalid-link, unlisted and en-only games are excluded and
// the seventh candidate (Neon Vault E2E) is cut off at six.
const EXPECTED = [
  "bounce-lab-e2e",
  "rope-verse-e2e",
  "fog-path-e2e",
  "summit-rush-e2e",
  "cliff-edge-e2e",
  "sky-hopper-e2e",
];
const EXCLUDED = ["vault-sprint-e2e", "orbit-keeper-e2e", "kite-field-e2e", "lone-tide-e2e", "neon-vault-e2e", "wall-drift-e2e"];

test("E22 相关游戏：与 18.2 算法一致、最多 6 条、点击计入 related_click", async ({ page, request }) => {
  for (const locale of ["en", "zh"]) {
    const detail = await (await request.get(`/api/games/trail-runner-e2e?locale=${locale}`)).json();
    const related = (pick<any[]>(detail, "related") ?? []).map((g) => pick<string>(g, "slug"));
    expect(related, locale).toEqual(EXPECTED);
    for (const banned of EXCLUDED) expect(related).not.toContain(banned);
  }

  const view = await (await request.get("/api/games/trail-runner-e2e?locale=en")).json();
  const sourceId = pick<string>(view, "id", "ID");
  const target = await (await request.get("/api/games/bounce-lab-e2e?locale=en")).json();
  const targetId = pick<string>(target, "id", "ID");

  const events = collectEvents(page);
  await page.goto("/en/games/trail-runner-e2e");
  const section = page.getByRole("heading", { name: /Related games|相关游戏/ });
  await expect(section).toBeVisible();
  const relatedLinks = page.locator(`main a[href="/en/games/${EXPECTED[0]}"]`).first();
  await expect(relatedLinks).toBeVisible();

  // A game with no candidates hides the whole module (checked before the
  // click flow below).
  await page.goto("/en/games/lone-tide-e2e");
  await expect(page.getByRole("heading", { name: /Related games|相关游戏/ })).toHaveCount(0);
  await page.goto("/en/games/trail-runner-e2e");

  const popup = page.waitForEvent("popup", { timeout: 1500 }).catch(() => null); // related cards never leave the site
  await relatedLinks.click();
  await expect(page).toHaveURL(new RegExp(`/en/games/${EXPECTED[0]}$`));
  expect(await popup).toBeNull();

  // One related_click for the source game, and the target detail view was
  // attributed to entrySource=related.
  await expect.poll(() => countEvent(events, "related_click")).toBe(1);
  const click = events.find((e) => e.eventName === "related_click");
  expect(pick<string>(click, "sourceGameId")).toBe(sourceId);
  expect(pick<string>(click, "gameId")).toBe(targetId);
  expect(pick<string>(click, "placement")).toBe("detail_related");
  await expect
    .poll(() => events.filter((e) => e.eventName === "game_view" && e.gameId === targetId).length)
    .toBe(1);
  const targetView = events.find((e) => e.eventName === "game_view" && e.gameId === targetId);
  expect(pick<string>(targetView, "entrySource")).toBe("related");
});
