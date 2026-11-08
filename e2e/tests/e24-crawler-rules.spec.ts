import { test, expect } from "@playwright/test";
import { adminLogin, adminFindGame, adminGet, adminPost, adminPatch, pick } from "../lib/api";
import { crawl } from "../lib/crawl";
import { control, fakeLog, clearFakeLog, logTime } from "../lib/fake";

/** Latest sync run for a task, as exposed by GET /api/admin/crawler. */
async function latestRun(request: any, task: string) {
  const status = await adminGet(request, "/crawler");
  const runs = (pick<any[]>(status, "runs") ?? []).filter((r) => pick<string>(r, "task") === task);
  expect(runs.length, `a ${task} run exists`).toBeGreaterThan(0);
  return [...runs].sort((a, b) => String(pick<any>(a, "startedAt", "started_at")).localeCompare(String(pick<any>(b, "startedAt", "started_at")))).at(-1)!;
}

test("E24 爬虫规则与熔断：串行≥2s、UA、robots 禁止、Retry-After、5×429 熔断、跨主机重定向", async ({ request }) => {
  test.setTimeout(600_000);
  await adminLogin(request);
  await adminPatch(request, "/crawler", { enabled: true, dailyCap: 1000, minIntervalMs: 2000, hotAutoPublish: true });
  await control({});
  await clearFakeLog();

  // Baseline: exactly robots + sitemap, serial with >= 2s spacing, honest UA.
  expect(crawl("sitemap").status).toBe(0);
  let run = await latestRun(request, "sitemap");
  expect(pick<string>(run, "outcome")).toBe("ok");
  expect(pick<number>(run, "requests")).toBe(2);
  let log = await fakeLog();
  expect(log.map((i) => i.path)).toEqual(["/robots.txt", "/en/sitemap"]);
  for (let i = 1; i < log.length; i++) {
    expect(logTime(log[i]) - logTime(log[i - 1])).toBeGreaterThanOrEqual(2000);
  }
  expect(log.every((i) => i.ua.startsWith("PlayTrailBot/1.0 (+"))).toBe(true);

  // robots.txt disallows the sitemap for our UA: the run refuses before any
  // content request.
  await control({ global: { type: "robots_disallow", times: 1 } });
  await clearFakeLog();
  expect(crawl("sitemap").status).toBe(0); // the run ends cleanly as "failed"
  run = await latestRun(request, "sitemap");
  expect(pick<string>(run, "outcome")).toBe("failed");
  expect(pick<string>(run, "abortReason", "abort_reason")).toMatch(/disallowed/i);
  expect(pick<number>(run, "requests")).toBe(1);
  expect((await fakeLog()).map((i) => i.path)).toEqual(["/robots.txt"]);

  // 429 with Retry-After: the crawler waits, retries and finishes.
  await control({ global: { type: "rate_limit", retryAfterSec: 2, times: 2 } });
  await clearFakeLog();
  expect(crawl("sitemap").status).toBe(0);
  run = await latestRun(request, "sitemap");
  expect(pick<string>(run, "outcome")).toBe("ok");
  expect(pick<Record<string, number>>(run, "statusCounts", "status_counts")?.["429"]).toBe(2);
  expect(pick<number>(run, "requests")).toBe(4);
  log = await fakeLog();
  expect(log).toHaveLength(4);
  for (let i = 1; i < log.length; i++) {
    expect(logTime(log[i]) - logTime(log[i - 1])).toBeGreaterThanOrEqual(2000);
  }

  // Breaker: five 429s inside one run abort it; three aborted runs in a row
  // auto-disable the crawler until an administrator re-enables it.
  // Rate-limit the game pages only: robots stays clean, so the breaker
  // counts five 429s on content fetches (PRD 22.4.6).
  await control({
    games: Object.fromEntries(
      ["bloxdhop-io", "bloxity-io", "messy-mart", "steal-a-eggs"].map((slug) => [slug, { type: "rate_limit", retryAfterSec: 1 }]),
    ),
  });
  await clearFakeLog();
  for (let round = 1; round <= 3; round++) {
    await clearFakeLog();
    expect(crawl("tracked", 240_000).status).toBe(0);
    run = await latestRun(request, "tracked");
    expect(pick<string>(run, "outcome"), `round ${round}`).toBe("aborted");
    expect(pick<Record<string, number>>(run, "statusCounts", "status_counts")?.["429"]).toBe(5);
    expect(pick<number>(run, "requests")).toBe((await fakeLog()).length);
    if (round === 3) {
      const status = await adminGet(request, "/crawler");
      expect(pick<boolean>(status, "autoDisabled")).toBe(true);
      expect(pick<string>(status, "autoDisabledReason")).toMatch(/auto-disabled/i);
    }
  }
  const blocked = crawl("sitemap");
  expect(blocked.status).not.toBe(0);
  expect(blocked.stderr).toMatch(/auto-disabled/i);
  const reenabled = await adminPatch(request, "/crawler", { enabled: true });
  expect(reenabled.status()).toBe(200);
  const status = await adminGet(request, "/crawler");
  expect(pick<boolean>(status, "autoDisabled")).toBe(false);

  // Cross-host redirects are refused, the game goes suspect, CTA disabled.
  await control({});
  await clearFakeLog();
  await control({});
  await clearFakeLog();
  await control({ games: { "bloxdhop-io": { type: "redirect" } } });
  expect(crawl("tracked").status).toBe(0);
  expect((await fakeLog()).filter((i) => i.path === "/game/bloxdhop-io")).toHaveLength(1);
  const game = await adminFindGame(request, "bloxdhop-io");
  const after = await adminGet(request, `/games/${pick<string>(game, "id", "ID")}`);
  expect(pick<string>(after, "linkStatus")).toBe("suspect");
  expect(pick<string>(after.source ?? {}, "lastFetchResult")).toBe("redirected");
  const pub = await (await request.get("/api/games/bloxdhop-io?locale=en")).json();
  expect(pick<boolean>(pub, "outboundAllowed")).toBe(false);

  // Restore for the later scenarios (E26 needs this game valid again).
  await control({});
  const restored = await adminPost(request, `/games/${pick<string>(game, "id", "ID")}/link-check`, {
    status: "valid", note: "e2e restore after redirect scenario",
  });
  expect(restored.ok()).toBeTruthy();
});
