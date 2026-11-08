import { test, expect } from "@playwright/test";
import { adminLogin, pick } from "../lib/api";

const TOTAL = 30;
const PAGE_SIZE = 24;
const BULK = new Set(Array.from({ length: 11 }, (_, i) => `e2e-bulk-${String(i + 1).padStart(2, "0")}`));

async function listPage(request: any, sort: string, page: number) {
  const res = await request.get(`/api/games?locale=en&sort=${sort}&page=${page}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  return {
    total: pick<number>(body, "total") as number,
    slugs: (pick<any[]>(body, "items") ?? []).map((g) => pick<string>(g, "slug")),
  };
}

test("E03 排序分页：24/页、无重复遗漏、editorialOrder→id 打平、越界页为空", async ({ page, request }) => {
  // Public cards do not carry ordering metadata; read it from the admin list.
  await adminLogin(request);
  const admin = await (await request.get("/api/admin/games?pageSize=100")).json();
  const orderOf = new Map<string, number>();
  for (const row of pick<any[]>(admin, "items") ?? []) {
    orderOf.set(pick<string>(row, "slug"), pick<number>(row, "editorialOrder"));
  }

  const p1 = await listPage(request, "editorial", 1);
  const p2 = await listPage(request, "editorial", 2);
  expect(p1.total).toBe(TOTAL);
  expect(p1.slugs).toHaveLength(PAGE_SIZE);
  expect(p2.slugs).toHaveLength(TOTAL - PAGE_SIZE);

  const all = [...p1.slugs, ...p2.slugs];
  expect(new Set(all).size).toBe(TOTAL); // no duplicates, no gaps

  // Ordering rule: editorial_order asc, ties broken by id asc. Rebuild the
  // expected sequence from (order, id) pairs and compare element by element.
  const detail = new Map<string, { order: number; id: string }>();
  for (const slug of all) {
    const d = await (await request.get(`/api/games/${slug}?locale=en`)).json();
    detail.set(slug, { order: orderOf.get(slug) ?? 0, id: pick<string>(d, "id", "ID") });
  }
  const expected = [...all].sort((a, b) => {
    const x = detail.get(a)!;
    const y = detail.get(b)!;
    return x.order - y.order || (x.id < y.id ? -1 : 1);
  });
  expect(all).toEqual(expected);
  for (const slug of all.slice(0, TOTAL - 11)) expect(BULK.has(slug)).toBeFalsy();
  for (const slug of all.slice(TOTAL - 11)) expect(BULK.has(slug)).toBeTruthy();

  // "Newest" sort: firstPublishedAt of the current locale, descending.
  const newest = await listPage(request, "newest", 1);
  expect(newest.total).toBe(TOTAL);
  const publishedAt = new Map<string, number>();
  for (const slug of newest.slugs) {
    const d = await (await request.get(`/api/games/${slug}?locale=en`)).json();
    publishedAt.set(slug, new Date(pick<string>(d, "firstPublishedAt")).getTime());
  }
  for (let i = 1; i < newest.slugs.length; i++) {
    expect(publishedAt.get(newest.slugs[i - 1])!).toBeGreaterThanOrEqual(publishedAt.get(newest.slugs[i])!);
  }

  // Out-of-range page: empty items, real total, no fallback to page 1.
  const beyond = await listPage(request, "editorial", 99);
  expect(beyond.total).toBe(TOTAL);
  expect(beyond.slugs).toHaveLength(0);

  // UI mirrors the API: an out-of-range page shows the empty state.
  await page.goto("/en/games?page=99");
  await expect(page.getByText(/No games on this trail|未找到/)).toBeVisible();
});
