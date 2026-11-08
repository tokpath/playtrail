import { test, expect } from "@playwright/test";
import { adminLogin, pick } from "../lib/api";

const IMPORT_KEY = "e2e-import-key-1";
const SRC = "2026-11-09T00:00:00+08:00";

function row(i: number) {
  return {
    name: `E2E Import ${String(i).padStart(2, "0")}`,
    slug: `e2e-import-${String(i).padStart(2, "0")}`,
    primaryCategory: "arcade",
    tags: ["casual"],
    externalUrl: `https://www.crazygames.com/game/e2e-import-${String(i).padStart(2, "0")}`,
    sourceUrl: `https://www.crazygames.com/game/e2e-import-${String(i).padStart(2, "0")}`,
    sourceFetchedAt: SRC,
    locales: { en: { summary: "An imported E2E draft entry used to verify import behaviour end to end.", description: "Imported E2E draft content for the PlayTrail acceptance suite. It stays a draft until a human reviews and publishes it." } },
  };
}

test("E12 导入与幂等：逐行报告、只生成草稿、importKey 幂等、整批拒绝", async ({ request }) => {
  await adminLogin(request);
  const games = [
    ...Array.from({ length: 20 }, (_, i) => row(i + 1)),
    // duplicate external URL of an existing fixture game
    { ...row(99), slug: "e2e-import-dup", name: "E2E Import Dup", externalUrl: "https://www.crazygames.com/game/bloxdhop-io", sourceUrl: "https://www.crazygames.com/game/bloxdhop-io" },
    // unknown category, malicious URL, insecure scheme, script text row
    { ...row(98), slug: "e2e-import-badcat", name: "E2E Import BadCat", primaryCategory: "not-a-category" },
    { ...row(97), slug: "e2e-import-evil", name: "E2E Import Evil", externalUrl: "https://www.crazygames.com.evil.example/game/evil", sourceUrl: "https://www.crazygames.com.evil.example/game/evil" },
    { ...row(96), slug: "e2e-import-http", name: "E2E Import Http", externalUrl: "http://www.crazygames.com/game/http-only", sourceUrl: "http://www.crazygames.com/game/http-only" },
    { ...row(95), slug: "e2e-import-script", name: "<script>alert(1)</script> Import E2E" },
  ];

  const previewRes = await request.post("/api/admin/imports/preview", { data: { schemaVersion: 1, games } });
  expect(previewRes.status()).toBe(200);
  const preview = await previewRes.json();
  const rows = pick<any[]>(preview, "rows") ?? [];
  const statusOf = (slug: string) => rows.find((r) => (pick<string>(r, "slug") ?? "").includes(slug) || pick<string>(r, "name") === slug);

  expect(rows.filter((r) => pick<string>(r, "status", "rowStatus") === "created").length).toBe(21);
  expect(rows.filter((r) => pick<string>(r, "status", "rowStatus") === "duplicate").length).toBe(1);
  const failed = rows.filter((r) => pick<string>(r, "status", "rowStatus") === "failed");
  expect(failed.length).toBe(3);
  expect(JSON.stringify(failed)).toMatch(/INVALID_URL/);
  expect(JSON.stringify(failed)).toMatch(/UNKNOWN_CATEGORY/);

  const commit1 = await request.post("/api/admin/imports/commit", { data: { previewId: pick<string>(preview, "previewId"), importKey: IMPORT_KEY } });
  expect(commit1.status()).toBe(200);
  const result1 = await commit1.json();

  // Same importKey: the stored result comes back with the IMPORT_KEY_REUSED
  // hint code (PRD appendix A), nothing is re-created.
  const commit2 = await request.post("/api/admin/imports/commit", { data: { previewId: pick<string>(preview, "previewId"), importKey: IMPORT_KEY } });
  expect(commit2.status()).toBe(200);
  const result2 = await commit2.json();
  expect(pick<string>(result2, "code")).toBe("IMPORT_KEY_REUSED");
  const withoutHint = (r: Record<string, unknown>) => {
    const { code, ...rest } = r;
    void code;
    return rest;
  };
  expect(withoutHint(result2)).toEqual(withoutHint(result1));
  // The admin list search matches names, not slugs — page the catalog and
  // count the imported slugs locally.
  const importedCount = async () => {
    const all = await (await request.get("/api/admin/games?pageSize=100")).json();
    return (pick<any[]>(all, "items") ?? []).filter((g) => pick<string>(g, "slug").startsWith("e2e-import-")).length;
  };
  expect(await importedCount()).toBe(21);

  // Imported rows are drafts, never public.
  const allAfter = await (await request.get("/api/admin/games?pageSize=100")).json();
  const sample = (pick<any[]>(allAfter, "items") ?? []).find((g) => pick<string>(g, "slug").startsWith("e2e-import-"));
  expect(pick<string>(sample, "status")).toBe("draft");
  expect((await (await request.get(`/api/games/${pick<string>(sample, "slug")}?locale=en`)).status())).toBe(404);

  // Structurally invalid batches are rejected whole: nothing new is written.
  for (const bad of [{ schemaVersion: 2, games: [row(1)] }, { broken: true }]) {
    const res = await request.post("/api/admin/imports/preview", { data: bad });
    expect(res.status()).toBe(400);
  }
  expect(await importedCount()).toBe(21);
});
