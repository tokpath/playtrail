-- 公开接口查询：全部只读 public_games / 字典 / 快照表（ADR A1）。

-- name: CountPublicGamesByLocale :one
SELECT count(*) FROM public_games WHERE locale = @locale;

-- name: CountPublicGames :one
SELECT count(*) FROM public_games
WHERE locale = @locale
  AND (sqlc.narg('q')::text IS NULL OR search_text LIKE sqlc.narg('q') ESCAPE '\')
  AND (sqlc.narg('category')::text IS NULL OR primary_category = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR sqlc.narg('tag') = ANY(tags));

-- name: ListPublicGamesByEditorial :many
SELECT * FROM public_games
WHERE locale = @locale
  AND (sqlc.narg('q')::text IS NULL OR search_text LIKE sqlc.narg('q') ESCAPE '\')
  AND (sqlc.narg('category')::text IS NULL OR primary_category = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR sqlc.narg('tag') = ANY(tags))
ORDER BY editorial_order, game_id
LIMIT @row_limit OFFSET @row_offset;

-- name: ListPublicGamesByNewest :many
SELECT * FROM public_games
WHERE locale = @locale
  AND (sqlc.narg('q')::text IS NULL OR search_text LIKE sqlc.narg('q') ESCAPE '\')
  AND (sqlc.narg('category')::text IS NULL OR primary_category = sqlc.narg('category'))
  AND (sqlc.narg('tag')::text IS NULL OR sqlc.narg('tag') = ANY(tags))
ORDER BY first_published_at DESC, game_id
LIMIT @row_limit OFFSET @row_offset;

-- name: ListFeaturedGames :many
SELECT * FROM public_games
WHERE locale = @locale AND featured
ORDER BY editorial_order, game_id
LIMIT 12;

-- name: GetPublicGame :one
SELECT * FROM public_games WHERE game_id = @game_id AND locale = @locale;

-- name: HasPublicGame :one
SELECT EXISTS(SELECT 1 FROM public_games WHERE game_id = @game_id AND locale = @locale) AS exists;

-- name: ListRelatedGames :many
SELECT pg.*
FROM public_games pg
WHERE pg.locale = @locale
  AND pg.game_id <> @game_id
  AND pg.outbound_allowed
  AND (
    3 * (CASE WHEN pg.primary_category = @category THEN 1 ELSE 0 END)
      + (SELECT count(*) FROM unnest(pg.tags) t JOIN unnest(@tags::text[]) g ON t = g)
  ) >= 1
ORDER BY (
    3 * (CASE WHEN pg.primary_category = @category THEN 1 ELSE 0 END)
      + (SELECT count(*) FROM unnest(pg.tags) t JOIN unnest(@tags::text[]) g ON t = g)
  ) DESC, pg.editorial_order, pg.game_id
LIMIT 6;

-- name: CategoryCounts :many
SELECT c.slug, c.names, c.sort_order, count(pg.*) AS count
FROM categories c
LEFT JOIN public_games pg ON pg.locale = @locale AND pg.primary_category = c.slug
GROUP BY c.slug, c.names, c.sort_order
HAVING count(pg.*) > 0
ORDER BY c.sort_order, c.slug;

-- name: CategoryCount :many
SELECT c.slug, c.names, c.sort_order, count(pg.*) AS count
FROM categories c
LEFT JOIN public_games pg ON pg.locale = @locale AND pg.primary_category = c.slug
WHERE c.slug = @slug
GROUP BY c.slug, c.names, c.sort_order;

-- name: TagCounts :many
SELECT t.slug, t.names, count(pg.*) AS count
FROM tags t
JOIN public_games pg ON pg.locale = @locale AND t.slug = ANY(pg.tags)
GROUP BY t.slug, t.names
ORDER BY t.slug;

-- name: ListLiveLocaleCounts :many
SELECT locale, count(*) AS count FROM public_games GROUP BY locale;

-- name: ListUnlistedSlugs :many
SELECT slug FROM games WHERE status = 'unlisted' ORDER BY slug;

-- name: ListSitemapGames :many
SELECT g.slug, max(s.published_at)::timestamptz AS updated_at, array_agg(s.locale)::text[] AS locales
FROM games g
JOIN game_locale_states s ON s.game_id = g.id
WHERE g.status = 'published'
GROUP BY g.id, g.slug;

-- name: ListSitemapCategories :many
SELECT primary_category AS slug, array_agg(DISTINCT locale)::text[] AS locales
FROM public_games
GROUP BY primary_category;

-- name: GetPublicGameBySlug :one
SELECT * FROM public_games WHERE slug = @slug AND locale = @locale;

-- name: ListPublicGamesByIDs :many
SELECT * FROM public_games WHERE locale = @locale AND game_id = ANY(@ids::uuid[]);

-- name: LatestPublishedAt :one
SELECT max(published_at)::timestamptz AS updated_at FROM public_games WHERE locale = @locale;
