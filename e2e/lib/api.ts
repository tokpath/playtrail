import type { APIRequestContext, Page } from "@playwright/test";
import path from "node:path";

export const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8091";
export const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:3100";
export const FAKE = process.env.E2E_FAKE_URL ?? "http://127.0.0.1:8095";
export const BACKEND_DIR = path.resolve(process.cwd(), "..", "backend");
export const DSN =
  process.env.E2E_DSN ??
  "postgres://playtrail:playtrail@127.0.0.1:55432/playtrail_e2e?sslmode=disable";
export const ADMIN_EMAIL = "e2e@playtrail.test";
export const ADMIN_PASSWORD = "e2e-admin-password-0123456789";

/** Session login for an API request context; the cookie jar keeps the session. */
export async function adminLogin(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API}/api/admin/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (res.status() !== 204) throw new Error(`admin login failed: ${res.status()} ${await res.text()}`);
}

/** Look up an admin game row by exact slug. */
export async function adminFindGame(request: APIRequestContext, slug: string) {
  // The admin search matches names, not slugs — fetch the catalog and filter
  // by the exact slug here (fixture catalogs are small).
  for (let page = 1; page < 10; page++) {
    const res = await request.get(`${API}/api/admin/games?page=${page}&pageSize=100`);
    if (!res.ok()) throw new Error(`admin games list failed: ${res.status()}`);
    const items = (await res.json()).items as Array<Record<string, any>>;
    const row = items.find((g) => g.slug === slug);
    if (row) return row;
    if (items.length < 100) break;
  }
  throw new Error(`admin game ${slug} not found`);
}

export async function adminGet(request: APIRequestContext, path: string) {
  const res = await request.get(`${API}/api/admin${path}`);
  if (!res.ok()) throw new Error(`GET /api/admin${path} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function adminPost(request: APIRequestContext, path: string, data?: unknown) {
  const res = await request.post(`${API}/api/admin${path}`, { data });
  return res;
}

export async function adminPatch(request: APIRequestContext, path: string, data?: unknown) {
  const res = await request.patch(`${API}/api/admin${path}`, { data });
  return res;
}

/** Settable test clock (e2e build only): POST sets, DELETE resets to real time. */
export async function setClock(request: APIRequestContext, now: string): Promise<void> {
  const res = await request.post(`${API}/api/_test/clock`, { data: { now } });
  if (res.status() !== 204) throw new Error(`set clock failed: ${res.status()} ${await res.text()}`);
}

export async function resetClock(request: APIRequestContext): Promise<void> {
  await request.delete(`${API}/api/_test/clock`);
}

/** Collect product events posted by the page (PRD 11), parsed from request bodies. */
export function collectEvents(page: Page) {
  const events: Array<Record<string, unknown>> = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/events")) {
      try {
        events.push(JSON.parse(req.postData() ?? "{}"));
      } catch {
        // ignore non-JSON bodies; the assertion then fails on the count
      }
    }
  });
  return events;
}

export function countEvent(events: Array<Record<string, unknown>>, name: string): number {
  return events.filter((e) => e.eventName === name).length;
}

/**
 * Field reader tolerant to Go struct marshalling: tries the given keys, then
 * their snake_case forms (sqlc rows marshal without json tags in some paths).
 */
export function pick<T = unknown>(obj: Record<string, unknown> | undefined | null, ...keys: string[]): T {
  if (!obj) return undefined as T;
  for (const k of keys) if (obj[k] !== undefined) return obj[k] as T;
  for (const k of keys) {
    const snake = k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
    if (obj[snake] !== undefined) return obj[snake] as T;
    const pascal = k[0].toUpperCase() + k.slice(1);
    if (obj[pascal] !== undefined) return obj[pascal] as T;
  }
  return undefined as T;
}
