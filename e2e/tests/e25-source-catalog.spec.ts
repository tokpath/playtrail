import { test, expect } from "@playwright/test";
import { adminLogin, adminGet, adminPost, pick } from "../lib/api";
import { crawl } from "../lib/crawl";
import { control, clearFakeLog } from "../lib/fake";

const SAMPLE_SLUGS = ["bloxdhop-io", "bloxity-io", "blombo-io", "grow-a-garden---growden-io", "messy-mart", "steal-a-eggs", "space-invaders", "pacman"];

test("E25 来源目录与收录：sitemap 目录、详情补全、收录为草稿、CG 文案不公开", async ({ request }) => {
  test.setTimeout(300_000);
  await adminLogin(request);
  await control({});
  await clearFakeLog();

  expect(crawl("sitemap").status).toBe(0);
  const catalog = await (await request.get("/api/admin/source-games?pageSize=50")).json();
  const rows = pick<any[]>(catalog, "items") ?? [];
  const slugs = rows.map((r) => pick<string>(r, "slug"));
  expect(slugs.sort()).toEqual([...SAMPLE_SLUGS].sort());

  // Detail backfill: the six sampled pages parse, the two unsampled slugs 404.
  expect(crawl("backfill", 300_000).status).toBe(0);
  const bySlug = new Map(rows.map((r) => [pick<string>(r, "slug"), r]));
  for (const slug of SAMPLE_SLUGS) {
    const detail = await adminGet(request, `/source-games/${pick<string>(bySlug.get(slug)!, "id", "ID")}`);
    const expected = SAMPLE_SLUGS.slice(0, 6).includes(slug) ? "ok" : "not_found";
    expect(pick<string>(detail, "lastFetchResult"), slug).toBe(expected);
  }
  const blomboDetail = await adminGet(request, `/source-games/${pick<string>(bySlug.get("blombo-io")!, "id", "ID")}`);
  expect(pick<string>(blomboDetail, "name")).toBe("Blombo.io");
  expect(pick<string>(blomboDetail, "developer")).toBe("MoVariYa");

  // Map one source tag, then collect the source row as a draft.
  const sourceTags = pick<string[]>(blomboDetail, "tags") ?? [];
  expect(sourceTags.length).toBeGreaterThan(0);
  await request.put(`/api/admin/tag-mappings/${sourceTags[0]}`, { data: { tagSlug: "casual" } });
  const collected = await request.post(`/api/admin/source-games/${pick<string>(blomboDetail, "id", "ID")}/collect`);
  expect(collected.status()).toBe(201);
  const draftRef = await collected.json();
  const draftId = pick<string>(draftRef, "id", "ID");
  const draft = await adminGet(request, `/games/${draftId}`);
  expect(pick<string>(draft, "status")).toBe("draft");
  expect(pick<string>(draft, "name")).toBe("Blombo.io");
  expect(pick<string>(draft, "externalUrl")).toBe("https://www.crazygames.com/game/blombo-io");
  expect(pick<string>(draft, "primaryCategory", "primary_category")).toBe("io");
  expect(pick<string>(draft, "coverSourcePath", "cover_source_path")).toContain("blombo-io_16x9");
  const draftTags = pick<string[]>(draft, "tags") ?? [];
  expect(draftTags).toContain("casual");
  // A collected draft has no published locale rows yet: content starts pending.
  const locales = pick<Record<string, any>>(draft, "locales") ?? {};
  expect(pick<string>(locales.en ?? {}, "contentReview") ?? "pending").toBe("pending");

  // The draft is nowhere public, and CG reference copy never leaks.
  expect((await request.get("/api/games/blombo-io?locale=en")).status()).toBe(404);
  const sitemap = JSON.stringify(await (await request.get("/api/sitemap?locale=en")).json());
  expect(sitemap).not.toContain("blombo-io");
  expect(sitemap).not.toContain("space-invaders");
  const reference = pick<Record<string, any>>(blomboDetail, "reference") ?? {};
  const leakProbe = String(pick<string>(reference, "descriptionFirst") ?? "").slice(0, 40);
  if (leakProbe.length > 10) {
    const home = await (await request.get("/en/")).text();
    const api = JSON.stringify(await (await request.get("/api/home?locale=en")).json());
    expect(home).not.toContain(leakProbe);
    expect(api).not.toContain(leakProbe);
  }
});
