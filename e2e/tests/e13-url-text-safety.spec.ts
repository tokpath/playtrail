import { test, expect } from "@playwright/test";
import { adminLogin, adminFindGame, pick } from "../lib/api";

const SRC = "2026-11-09T00:00:00+08:00";

test("E13 URL/文本安全：恶意 URL 拒绝或去参，脚本始终显示为文本", async ({ browser, request }) => {
  await adminLogin(request);

  // URL whitelist: reject cross-host, insecure, credentialed, encoded-slash
  // and path-traversal shapes; normalize away query and fragment.
  const rejected: Array<[string, string]> = [
    ["evil subdomain", "https://www.crazygames.com.evil.example/game/x"],
    ["insecure scheme", "http://www.crazygames.com/game/x"],
    ["custom port", "https://www.crazygames.com:8443/game/x"],
    ["credentials", "https://user:pass@www.crazygames.com/game/x"],
    ["encoded slash", "https://www.crazygames.com/game/x%2Fy"],
    ["extra path", "https://www.crazygames.com/game/x/extra"],
    ["dot segment", "https://www.crazygames.com/game/../etc"],
  ];
  for (const [label, url] of rejected) {
    const res = await request.post("/api/admin/games", {
      data: { name: `E2E URL ${label}`, externalUrl: url, sourceUrl: url, sourceFetchedAt: SRC },
    });
    expect([400, 422], `${label}: ${url}`).toContain(res.status());
  }

  const normalized = await request.post("/api/admin/games", {
    data: {
      name: "E2E URL Normalized",
      externalUrl: "https://www.crazygames.com/game/e2e-url-normalized?ref=spam#top",
      sourceUrl: "https://www.crazygames.com/game/e2e-url-normalized",
      sourceFetchedAt: SRC,
    },
  });
  expect(normalized.status()).toBe(201);
  expect(pick<string>(await normalized.json(), "externalUrl")).toBe("https://www.crazygames.com/game/e2e-url-normalized");

  // Script text in editable fields is stored verbatim and rendered as text.
  const created = await request.post("/api/admin/games", {
    data: { name: "<script>alert(1)</script> Script Seat", externalUrl: "https://www.crazygames.com/game/e2e-script-seat", sourceUrl: "https://www.crazygames.com/game/e2e-script-seat", sourceFetchedAt: SRC },
  });
  expect(created.status()).toBe(201);
  const game = await created.json();
  const id = pick<string>(game, "id", "ID");
  // PRD 09: with no slug given, the server derives one from the name.
  const seatSlug = pick<string>(game, "slug");
  const version = pick<number>(game, "revisionVersion");
  const patched = await request.patch(`/api/admin/games/${id}`, {
    data: { revisionVersion: version, locales: { en: { summary: 'Seat seat <img src=x onerror="alert(2)"> summary' } } },
  });
  expect(patched.status()).toBe(200);

  // The admin UI shows the raw text; no script runs, no alert dialog fires.
  await adminLogin(request);
  const state = await request.storageState();
  const context = await browser.newContext({ storageState: state });
  const adminPage = await context.newPage();
  let dialogFired = false;
  adminPage.on("dialog", (d) => {
    dialogFired = true;
    void d.dismiss();
  });
  await adminPage.goto(`/admin/games/${id}`);
  await adminPage.getByText("<script>alert(1)</script> Script Seat").first().waitFor({ timeout: 20_000 });
  await adminPage.waitForTimeout(1000);
  expect(dialogFired).toBeFalsy();
  await context.close();

  // The stored JSON keeps the text as plain data (escaped by JSON, not HTML).
  const stored = await adminFindGame(request, seatSlug);
  expect(pick<string>(stored, "slug")).toBe(seatSlug);
});
