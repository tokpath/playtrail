import type {
  CategoryCount,
  GameDetail,
  GameList,
  HomePayload,
  HotSnapshot,
  SitemapPayload,
  TagCount,
} from "./types";
import type { GameListQuery } from "./types";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:8081";

/** Cache tag conventions shared with the backend (ARCHITECTURE §7). */
export const TAGS = {
  games: "games",
  game: (slug: string) => `game:${slug}`,
  hot: "hot",
  dict: "dict",
} as const;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isGone(): boolean {
    return this.status === 410;
  }
}

type FetchOptions = {
  tags?: string[];
  revalidate?: number;
};

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { tags = [], revalidate = 30 } = options;
  let res: Response;
  try {
    res = await fetch(`${API_INTERNAL_URL}${path}`, {
      next: { revalidate, tags },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "The content service is unreachable");
  }
  if (res.ok) return (await res.json()) as T;
  let code = "INTERNAL_ERROR";
  let message = `Request failed with status ${res.status}`;
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
  } catch {
    // Non-JSON error body; keep the defaults above.
  }
  throw new ApiError(res.status, code, message);
}

export async function getMeta(): Promise<{
  supportedLocales: string[];
  liveLocales: string[];
  defaultLocale: string;
}> {
  return request("/api/meta", { revalidate: 30 });
}

export async function getHome(locale: string): Promise<HomePayload> {
  return request(`/api/home?locale=${locale}`, { tags: [TAGS.games, TAGS.hot] });
}

export async function getGames(locale: string, query: GameListQuery) {
  const params = new URLSearchParams({ locale });
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.tag) params.set("tag", query.tag);
  if (query.sort) params.set("sort", query.sort);
  params.set("page", String(query.page ?? 1));
  return request<GameList>(`/api/games?${params}`, { tags: [TAGS.games] });
}

export async function getGame(locale: string, slug: string): Promise<GameDetail> {
  return request(`/api/games/${encodeURIComponent(slug)}?locale=${locale}`, {
    tags: [TAGS.games, TAGS.game(slug)],
  });
}

export async function getCategories(locale: string): Promise<{ items: CategoryCount[] }> {
  return request(`/api/categories?locale=${locale}`, { tags: [TAGS.dict, TAGS.games] });
}

export async function getCategory(locale: string, slug: string): Promise<{ category: CategoryCount }> {
  return request(`/api/categories/${encodeURIComponent(slug)}?locale=${locale}`, {
    tags: [TAGS.dict, TAGS.games],
  });
}

export async function getTags(locale: string): Promise<{ items: TagCount[] }> {
  return request(`/api/tags?locale=${locale}`, { tags: [TAGS.dict, TAGS.games] });
}

export async function getHot(locale: string): Promise<{ snapshot: HotSnapshot | null }> {
  return request(`/api/hot?locale=${locale}`, { tags: [TAGS.hot] });
}

export async function getSitemap(locale: string): Promise<SitemapPayload> {
  return request(`/api/sitemap?locale=${locale}`, { tags: [TAGS.games, TAGS.dict] });
}

/** Live-locale lookup for pages that only need which locales are live. */
export async function getLiveLocales(): Promise<string[]> {
  const meta = await getMeta();
  return meta.liveLocales;
}
