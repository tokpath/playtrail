import type { components, operations } from "./schema";

/**
 * Convenience aliases over the openapi-typescript output. To regenerate:
 *   pnpm gen:api
 * (The generator reads api/openapi.yaml from the repo root.)
 */
export type Locale = components["schemas"]["Locale"];
export type ErrorCode = components["schemas"]["ErrorCode"];
export type ErrorBody = components["schemas"]["ErrorBody"];
export type Ref = components["schemas"]["Ref"];
export type Image = components["schemas"]["Image"];
export type GameCard = components["schemas"]["GameCard"];
export type GameDetail = components["schemas"]["GameDetail"];
export type GameList = components["schemas"]["GameList"];
export type HotSnapshot = components["schemas"]["HotSnapshot"];
export type CategoryCount = components["schemas"]["CategoryCount"];
export type TagCount = components["schemas"]["TagCount"];
export type Meta = operations["getMeta"]["responses"][200]["content"]["application/json"];
export type HomePayload = operations["getHome"]["responses"][200]["content"]["application/json"];
export type SitemapPayload = operations["getSitemap"]["responses"][200]["content"]["application/json"];
export type UnlistedSlugs = operations["getUnlistedSlugs"]["responses"][200]["content"]["application/json"];
export type EventInput = components["schemas"]["EventInput"];

export type GameSort = "editorial" | "newest";

export type GameListQuery = {
  q?: string | null;
  category?: string | null;
  tag?: string | null;
  sort?: GameSort;
  page?: number;
};
