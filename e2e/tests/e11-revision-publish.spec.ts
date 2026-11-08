import { test, expect } from "@playwright/test";
import { adminLogin, adminFindGame, adminGet, pick } from "../lib/api";

const SLUG = "wall-drift-e2e";
const B_DESC = "E2E revision B: this text only becomes public after the gates pass, and the previous published text stays live until then.";

test("E11 草稿修订与发布：公开仍是 A、预览是 B、门禁 422、发布后 60s 内一致", async ({ request }) => {
  await adminLogin(request);
  const game = await adminFindGame(request, SLUG);
  const id = pick<string>(game, "id", "ID");
  const detail = await adminGet(request, `/games/${id}`);
  const version = pick<number>(detail, "revisionVersion");
  const locales = pick<Record<string, any>>(detail, "locales") ?? {};
  const aDesc = pick<string>(locales.en ?? {}, "description");

  // Optimistic locking: a stale version conflicts.
  const stale = await request.post(`/api/admin/games/${id}/publish`, { data: { revisionVersion: version - 1 } });
  expect(stale.status()).toBe(409);
  expect(((await stale.json()) as any).code).toBe("REVISION_CONFLICT");

  // Save revision B without reviewing: public keeps A, admin previews B.
  const patch = await request.patch(`/api/admin/games/${id}`, {
    data: { revisionVersion: version, locales: { en: { description: B_DESC } } },
  });
  expect(patch.status()).toBe(200);
  const newVersion = pick<number>(await patch.json(), "revisionVersion");
  expect(newVersion).toBe(version + 1);

  let pub = await (await request.get(`/api/games/${SLUG}?locale=en`)).json();
  expect(pick<string>(pub, "description")).toBe(aDesc);
  const preview = await adminGet(request, `/games/${id}/preview?locale=en`);
  expect(pick<string>(preview, "description")).toBe(B_DESC);

  // Publishing an unreviewed locale fails the language gate with 422.
  const gated = await request.post(`/api/admin/games/${id}/publish`, {
    data: { revisionVersion: newVersion, locales: ["en"] },
  });
  expect(gated.status()).toBe(422);
  expect(((await gated.json()) as any).code).toBe("PUBLISH_GATE_FAILED");
  expect(JSON.stringify(((await gated.json()) as any).fieldErrors ?? {})).toMatch(/contentReview|review/i);
  pub = await (await request.get(`/api/games/${SLUG}?locale=en`)).json();
  expect(pick<string>(pub, "description")).toBe(aDesc);

  // Approve the language, publish again — public content becomes B promptly.
  const review = await request.post(`/api/admin/games/${id}/locales/en/review`, {
    data: { revisionVersion: newVersion, decision: "approved", confirmOriginal: true, confirmFactsVerified: true },
  });
  expect(review.status()).toBe(200);
  // The review bumps the optimistic lock; publish with its returned version.
  const reviewed = await review.json();
  const published = await request.post(`/api/admin/games/${id}/publish`, {
    data: { revisionVersion: pick<number>(reviewed, "revisionVersion"), locales: ["en"] },
  });
  expect(published.status()).toBe(200);

  await expect
    .poll(async () => pick<string>(await (await request.get(`/api/games/${SLUG}?locale=en`)).json(), "description"), {
      timeout: 60_000,
      intervals: [2_000],
    })
    .toBe(B_DESC);
});
