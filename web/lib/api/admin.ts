"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { components } from "./schema";

/** Admin-only client API layer (ARCHITECTURE §6.3). Session cookie auth,
 * CSRF via same-origin Origin header; errors carry fieldErrors + requestId. */

export type S = components["schemas"];
export type AdminGame = S["AdminGame"];
export type AdminGameRow = S["AdminGameRow"];
export type AdminGameList = S["AdminGameList"];
export type GateReport = S["GateReport"];
export type MediaAsset = S["MediaAsset"];
export type AdminCategory = S["AdminCategory"];
export type AdminTag = S["AdminTag"];
export type AdminHotSnapshot = S["AdminHotSnapshot"];
export type ImportPreview = S["ImportPreview"];
export type ImportResult = S["ImportResult"];
export type StatsReport = S["StatsReport"];
export type CrawlerStatus = S["CrawlerStatus"];
export type AuditEntry = S["AuditEntry"];
export type SourceGameRow = S["SourceGameRow"];
export type SourceChange = S["SourceChange"];
export type GameDetail = S["GameDetail"];

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
  try {
    res = await fetch(path, { ...init, headers, credentials: "include" });
  } catch {
    throw new AdminApiError(0, "NETWORK_ERROR", "无法连接到服务器");
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 204-style or empty body
  }
  if (!res.ok) {
    const err = (body ?? {}) as { code?: string; message?: string; fieldErrors?: Record<string, string>; requestId?: string };
    throw new AdminApiError(
      res.status,
      err.code ?? "INTERNAL_ERROR",
      err.message ?? `请求失败（HTTP ${res.status}）`,
      err.fieldErrors,
      err.requestId,
    );
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

/** Tiny fetch-on-mount hook with manual reload; races collapse to the latest. */
export function useApi<T>(path: string | null): {
  data: T | null;
  error: AdminApiError | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [loading, setLoading] = useState(path != null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const [lastPath, setLastPath] = useState(path);

  // Flag loading on path changes during render (sanctioned pattern); reload
  // sets it in its event handler. The effect itself only fetches.
  if (path !== lastPath) {
    setLastPath(path);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    if (!path) return;
    const run = ++latest.current;
    adminFetch<T>(path)
      .then((d) => {
        if (latest.current === run) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: AdminApiError) => {
        if (latest.current === run) {
          setError(e);
          setLoading(false);
        }
      });
  }, [path, tick]);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
    setLoading(true);
    setError(null);
  }, []);
  return { data, error, loading, reload };
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const adminApi = {
  login: (email: string, password: string) =>
    adminFetch<void>("/api/admin/login", { ...json({ email, password }), method: "POST" }),
  logout: () => adminFetch<void>("/api/admin/logout", { method: "POST" }),
  me: () => adminFetch<{ id: string; email: string }>("/api/admin/me"),
  dashboard: () =>
    adminFetch<{
      counts: { draft: number; published: number; unlisted: number; pendingReview: number; suspectLinks: number; sourceChangesPending: number };
      liveLocales: string[];
      crawler: CrawlerStatus;
      hot: { sourceFetchedAt: string; stale: boolean } | null;
    }>("/api/admin/dashboard"),

  listGames: (query: Parameters<typeof adminListGamesQuery>[0]) =>
    adminFetch<AdminGameList>("/api/admin/games" + adminListGamesQuery(query)),
  getGame: (id: string) => adminFetch<AdminGame>(`/api/admin/games/${id}`),
  createGame: (body: {
    name: string;
    externalUrl: string;
    sourceUrl: string;
    sourceFetchedAt: string;
    slug?: string;
    primaryCategory?: string;
    tags?: string[];
  }) => adminFetch<AdminGame>("/api/admin/games", { ...json(body), method: "POST" }),
  patchGame: (id: string, body: Record<string, unknown>) =>
    adminFetch<AdminGame>(`/api/admin/games/${id}`, { ...json(body), method: "PATCH" }),
  reviewLocale: (id: string, locale: string, body: { revisionVersion: number; decision: "approved" | "rejected"; confirmOriginal: boolean; confirmFactsVerified: boolean }) =>
    adminFetch<AdminGame>(`/api/admin/games/${id}/locales/${locale}/review`, { ...json(body), method: "POST" }),
  linkCheck: (id: string, body: { status: "valid" | "suspect" | "invalid"; note: string }) =>
    adminFetch<AdminGame>(`/api/admin/games/${id}/link-check`, { ...json(body), method: "POST" }),
  gates: (id: string, locales?: string) =>
    adminFetch<GateReport>(`/api/admin/games/${id}/gates${locales ? `?locales=${locales}` : ""}`),
  publish: (id: string, body: { revisionVersion: number; locales?: string[] }) =>
    adminFetch<AdminGame>(`/api/admin/games/${id}/publish`, { ...json(body), method: "POST" }),
  unlist: (id: string, reason: string) =>
    adminFetch<AdminGame>(`/api/admin/games/${id}/unlist`, { ...json({ reason }), method: "POST" }),
  outbound: (id: string, enabled: boolean, reason: string) =>
    adminFetch<AdminGame>(`/api/admin/games/${id}/outbound`, { ...json({ enabled, reason }), method: "POST" }),
  preview: (id: string, locale: string) =>
    adminFetch<GameDetail>(`/api/admin/games/${id}/preview?locale=${locale}`),

  uploadMedia: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return adminFetch<MediaAsset>("/api/admin/media", { body: form, method: "POST" });
  },
  getMedia: (id: string) => adminFetch<MediaAsset>(`/api/admin/media/${id}`),
  patchMedia: (id: string, body: { rightsType?: "original" | "licensed" | "unknown"; rightsEvidenceRef?: string; rightsNote?: string; reviewState?: "pending" | "approved" | "rejected" }) =>
    adminFetch<MediaAsset>(`/api/admin/media/${id}`, { ...json(body), method: "PATCH" }),

  categories: () => adminFetch<{ items: AdminCategory[] }>("/api/admin/categories"),
  patchCategory: (slug: string, body: { names?: Record<string, string>; sortOrder?: number }) =>
    adminFetch<{ items: AdminCategory[] }>(`/api/admin/categories/${slug}`, { ...json(body), method: "PATCH" }),
  tags: () => adminFetch<{ items: AdminTag[] }>("/api/admin/tags"),
  createTag: (body: { slug: string; names: Record<string, string> }) =>
    adminFetch<AdminTag>("/api/admin/tags", { ...json(body), method: "POST" }),
  patchTag: (slug: string, body: { names?: Record<string, string>; active?: boolean }) =>
    adminFetch<AdminTag>(`/api/admin/tags/${slug}`, { ...json(body), method: "PATCH" }),

  hotList: () => adminFetch<{ items: AdminHotSnapshot[] }>("/api/admin/hot-snapshots"),
  hotCreate: (body: {
    sourceUrl: string;
    sourceFetchedAt: string;
    observedRegion: string;
    definition: string;
    cacheNote: string;
    items: { position: number; sourceSlug: string }[];
  }) => adminFetch<AdminHotSnapshot>("/api/admin/hot-snapshots", { ...json(body), method: "POST" }),
  hotReview: (id: string, decision: "approved" | "rejected") =>
    adminFetch<AdminHotSnapshot>(`/api/admin/hot-snapshots/${id}/review`, { ...json({ decision }), method: "POST" }),
  hotDeactivate: (id: string) =>
    adminFetch<AdminHotSnapshot>(`/api/admin/hot-snapshots/${id}/deactivate`, { method: "POST" }),

  importPreview: (raw: string) =>
    adminFetch<ImportPreview>("/api/admin/imports/preview", { body: raw, method: "POST" }),
  importCommit: (previewId: string, importKey: string) =>
    adminFetch<ImportResult>("/api/admin/imports/commit", { ...json({ previewId, importKey }), method: "POST" }),
  importGet: (id: string) => adminFetch<ImportResult>(`/api/admin/imports/${id}`),

  stats: (from: string, to: string) => adminFetch<StatsReport>(`/api/admin/stats${qs({ from, to })}`),
  audit: (page: number) =>
    adminFetch<{ items: AuditEntry[]; total: number; page: number; pageSize: number; totalPages: number }>(
      `/api/admin/audit${qs({ page })}`,
    ),

  sourceGames: (query: { q?: string; category?: string; mobile?: boolean; collected?: boolean; detail?: "yes" | "no"; page?: number }) =>
    adminFetch<{ items: SourceGameRow[]; total: number; page: number; pageSize: number; totalPages: number }>(
      "/api/admin/source-games" + qs(query as Record<string, string | number | boolean | undefined>),
    ),
  sourceGame: (id: string) =>
    adminFetch<SourceGameRow & { reference: Record<string, unknown>; raw?: Record<string, unknown> | null }>(
      `/api/admin/source-games/${id}`,
    ),
  collect: (id: string) => adminFetch<AdminGame>(`/api/admin/source-games/${id}/collect`, { method: "POST" }),

  sourceChanges: (state?: string, page?: number) =>
    adminFetch<{ items: SourceChange[]; total: number; page: number }>(
      `/api/admin/source-changes${qs({ state, page })}`,
    ),
  resolveChange: (id: string, action: "accept" | "ignore") =>
    adminFetch<SourceChange>(`/api/admin/source-changes/${id}/resolve`, { ...json({ action }), method: "POST" }),

  tagMappings: () =>
    adminFetch<{ items: { sourceTagSlug: string; tagSlug?: string | null }[] }>("/api/admin/tag-mappings"),
  putTagMapping: (sourceTagSlug: string, tagSlug: string | null) =>
    adminFetch<{ sourceTagSlug: string; tagSlug?: string | null }>(`/api/admin/tag-mappings/${sourceTagSlug}`, {
      ...json({ tagSlug }),
      method: "PUT",
    }),

  crawler: () => adminFetch<CrawlerStatus>("/api/admin/crawler"),
  patchCrawler: (body: { enabled?: boolean; dailyCap?: number; minIntervalMs?: number; hotAutoPublish?: boolean }) =>
    adminFetch<CrawlerStatus>("/api/admin/crawler", { ...json(body), method: "PATCH" }),
  crawlerRun: (task: "sitemap" | "tracked" | "backfill" | "hot") =>
    adminFetch<void>("/api/admin/crawler/run", { ...json({ task }), method: "POST" }),
};

function adminListGamesQuery(query: {
  status?: string;
  linkStatus?: string;
  review?: string;
  locale?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}): string {
  return qs(query);
}

/** Public URL of a stored media variant. */
export function mediaUrl(assetPath: string): string {
  return `/media/${assetPath}`;
}

/** CrazyGames CDN cover URL for a coverSourcePath (PRD 22.12). */
export function cgCoverUrl(path: string): string {
  return `https://imgs.crazygames.com/${path}?metadata=none`;
}
