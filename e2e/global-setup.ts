import { request } from "@playwright/test";
import { API, WEB, FAKE, adminLogin, adminFindGame, adminPost } from "./lib/api";

async function waitFor(label: string, probe: () => Promise<boolean>, tries = 120): Promise<void> {
  for (let i = 1; i <= tries; i++) {
    try {
      if (await probe()) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`global setup: ${label} not healthy`);
}

async function ensureUnlisted(ctx: Awaited<ReturnType<typeof request.newContext>>, slug: string) {
  const game = await adminFindGame(ctx, slug);
  if (game.status === "unlisted") return;
  const res = await adminPost(ctx, `/games/${game.id}/unlist`, { reason: "e2e fixture: unlisted game" });
  if (!res.ok()) throw new Error(`unlist ${slug}: ${res.status()} ${await res.text()}`);
}

async function ensureLinkStatus(
  ctx: Awaited<ReturnType<typeof request.newContext>>,
  slug: string,
  status: "suspect" | "invalid",
) {
  const game = await adminFindGame(ctx, slug);
  if (game.linkStatus === status) return;
  const res = await adminPost(ctx, `/games/${game.id}/link-check`, {
    status,
    note: `e2e fixture: ${status} link`,
  });
  if (!res.ok()) throw new Error(`link-check ${slug}: ${res.status()} ${await res.text()}`);
}

export default async function globalSetup() {
  const ctx = await request.newContext();
  await waitFor("api", async () => (await ctx.get(`${API}/api/meta`)).ok());
  await waitFor("web", async () => {
    const res = await ctx.get(`${WEB}/en/`);
    return res.status() === 200;
  });
  await waitFor("fake-crazygames", async () => (await ctx.get(`${FAKE}/_control`)).ok());

  // States the seed pack cannot create (PRD 13): one unlisted game, one
  // suspect link, one invalid link. Everything else is deterministic seed data.
  await adminLogin(ctx);
  await ensureUnlisted(ctx, "orbit-keeper-e2e");
  await ensureLinkStatus(ctx, "e2e-bulk-01", "suspect");
  await ensureLinkStatus(ctx, "vault-sprint-e2e", "invalid");
  await ctx.dispose();
}
