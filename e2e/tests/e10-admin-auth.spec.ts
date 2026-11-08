import { test, expect } from "@playwright/test";
import { adminLogin, adminFindGame, API } from "../lib/api";

test("E10 后台鉴权：未认证 401、跨来源写 403，不只是隐藏按钮", async ({ request }) => {
  const adminPaths: Array<[string, string, unknown?]> = [
    ["GET", "/api/admin/games"],
    ["GET", "/api/admin/stats?from=2026-11-01&to=2026-11-09"],
    ["GET", "/api/admin/crawler"],
    ["GET", "/api/admin/imports/x"],
    ["POST", "/api/admin/games", { name: "Nope", externalUrl: "https://www.crazygames.com/game/nope-e2e" }],
    ["POST", "/api/admin/imports/preview", { schemaVersion: 1, games: [] }],
    ["POST", "/api/admin/games/x/publish", {}],
    ["POST", "/api/admin/games/x/unlist", { reason: "nope" }],
  ];
  for (const [method, path, data] of adminPaths) {
    const res = await request.fetch(`${API}${path}`, { method, data });
    expect(res.status(), `${method} ${path}`).toBe(401);
    expect(((await res.json()) as any).code).toBe("UNAUTHENTICATED");
  }

  await adminLogin(request);
  const me = await request.get(`${API}/api/admin/me`);
  expect(me.status()).toBe(200);

  // Authenticated but cross-origin write: CSRF protection rejects with 403.
  const forged = await request.fetch(`${API}/api/admin/games`, {
    method: "POST",
    headers: { Origin: "https://evil.example" },
    data: { name: "Evil Write", externalUrl: "https://www.crazygames.com/game/evil-write-e2e" },
  });
  expect(forged.status()).toBe(403);
  expect(((await forged.json()) as any).code).toBe("FORBIDDEN");

  // Nothing was written by the forged call.
  const list = await (await request.get(`${API}/api/admin/games?q=Evil%20Write`)).json();
  expect((list.items ?? []).length).toBe(0);

  // The preview endpoint requires the session too.
  const game = await adminFindGame(request, "e2e-draft-alpha-e2e");
  const preview = await request.get(`${API}/api/admin/games/${game.id ?? game.ID}/preview?locale=en`);
  expect(preview.status()).toBe(200);
});
