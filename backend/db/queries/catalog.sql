-- 游戏与修订的管理写入查询。发布门禁逻辑在 catalog 领域包。

-- name: InsertGame :one
INSERT INTO games (slug, external_url)
VALUES (@slug, @external_url)
RETURNING *;

-- name: GetGame :one
SELECT * FROM games WHERE id = @id;

-- name: GetGameForUpdate :one
SELECT * FROM games WHERE id = @id FOR UPDATE;

-- name: GetGameBySlug :one
SELECT * FROM games WHERE slug = $1;

-- name: GetGameByExternalURL :one
SELECT * FROM games WHERE external_url = $1;

-- name: SetGameIdentity :exec
UPDATE games SET slug = @slug, external_url = @external_url, updated_at = now() WHERE id = @id;

-- name: SetGameDraftRevision :exec
UPDATE games SET draft_revision_id = @revision_id, updated_at = now() WHERE id = @id;

-- name: SetGameOps :exec
UPDATE games
SET featured = COALESCE(sqlc.narg('featured'), featured),
    editorial_order = COALESCE(sqlc.narg('editorial_order'), editorial_order),
    updated_at = now()
WHERE id = @id;

-- name: SetGameLinkCheck :exec
UPDATE games
SET link_status = @status, link_checked_at = @checked_at,
    link_check_method = 'manual', link_check_note = @note, updated_at = now()
WHERE id = @id;

-- name: SetGameStatus :exec
UPDATE games SET status = @status, status_reason = @reason, updated_at = now() WHERE id = @id;

-- name: SetGameOutbound :exec
UPDATE games SET outbound_disabled = @disabled, outbound_disabled_reason = @reason, updated_at = now() WHERE id = @id;

-- name: PublishGame :one
UPDATE games
SET published_revision_id = @revision_id, draft_revision_id = NULL, status = 'published',
    first_published_at = COALESCE(first_published_at, @now), revision_version = revision_version + 1,
    updated_at = now()
WHERE id = @id
RETURNING *;

-- name: BumpRevisionVersion :one
UPDATE games SET revision_version = revision_version + 1, updated_at = now() WHERE id = @id RETURNING revision_version;

-- name: InsertRevision :one
INSERT INTO game_revisions (
  game_id, name, developer, primary_category, tags,
  device_support, device_evidence_url, device_checked_at,
  source_url, source_fetched_at, cover_asset_id, screenshot_asset_ids,
  cover_source_path, use_placeholder, material_review, created_by
) VALUES (
  @game_id, @name, @developer, @primary_category, @tags,
  @device_support, @device_evidence_url, @device_checked_at,
  @source_url, @source_fetched_at, @cover_asset_id, @screenshot_asset_ids,
  @cover_source_path, @use_placeholder, @material_review, @created_by
)
RETURNING *;

-- name: CopyRevision :one
INSERT INTO game_revisions (
  game_id, name, developer, primary_category, tags,
  device_support, device_evidence_url, device_checked_at,
  source_url, source_fetched_at, cover_asset_id, screenshot_asset_ids,
  cover_source_path, use_placeholder, material_review, created_by
)
SELECT gr.game_id, gr.name, gr.developer, gr.primary_category, gr.tags,
       gr.device_support, gr.device_evidence_url, gr.device_checked_at,
       gr.source_url, gr.source_fetched_at, gr.cover_asset_id, gr.screenshot_asset_ids,
       gr.cover_source_path, gr.use_placeholder, gr.material_review, @created_by
FROM game_revisions gr WHERE gr.id = @id
RETURNING *;

-- name: CopyRevisionLocales :exec
INSERT INTO game_revision_locales (
  revision_id, locale, alias, summary, description, controls,
  media_alt, content_review, reviewed_at, reviewed_by, translation_method
)
SELECT @to_revision, src.locale, src.alias, src.summary, src.description, src.controls,
       src.media_alt, src.content_review, src.reviewed_at, src.reviewed_by, src.translation_method
FROM game_revision_locales src WHERE src.revision_id = @from_revision;

-- name: ClearRevisionCover :exec
UPDATE game_revisions SET cover_asset_id = NULL WHERE id = @id;

-- name: GetRevision :one
SELECT * FROM game_revisions WHERE id = @id;

-- name: UpdateRevision :one
UPDATE game_revisions SET
  name = COALESCE(sqlc.narg('name'), name),
  developer = COALESCE(sqlc.narg('developer'), developer),
  primary_category = COALESCE(sqlc.narg('primary_category')::text, primary_category),
  tags = COALESCE(sqlc.narg('tags')::text[], tags),
  device_support = COALESCE(sqlc.narg('device_support'), device_support),
  device_evidence_url = COALESCE(sqlc.narg('device_evidence_url'), device_evidence_url),
  device_checked_at = COALESCE(sqlc.narg('device_checked_at')::timestamptz, device_checked_at),
  source_url = COALESCE(sqlc.narg('source_url'), source_url),
  source_fetched_at = COALESCE(sqlc.narg('source_fetched_at')::timestamptz, source_fetched_at),
  cover_asset_id = COALESCE(sqlc.narg('cover_asset_id')::uuid, cover_asset_id),
  cover_source_path = COALESCE(sqlc.narg('cover_source_path'), cover_source_path),
  screenshot_asset_ids = COALESCE(sqlc.narg('screenshot_asset_ids')::uuid[], screenshot_asset_ids),
  use_placeholder = COALESCE(sqlc.narg('use_placeholder'), use_placeholder),
  material_review = COALESCE(sqlc.narg('material_review'), material_review)
WHERE id = @id
RETURNING *;

-- name: GetRevisionLocale :one
SELECT * FROM game_revision_locales WHERE revision_id = @revision_id AND locale = @locale;

-- name: ListRevisionLocales :many
SELECT * FROM game_revision_locales WHERE revision_id = @revision_id;

-- name: UpsertRevisionLocale :one
INSERT INTO game_revision_locales (
  revision_id, locale, alias, summary, description, controls,
  media_alt, content_review, translation_method, reviewed_at, reviewed_by
) VALUES (
  @revision_id, @locale, @alias, @summary, @description, @controls,
  @media_alt, @content_review, @translation_method, @reviewed_at, @reviewed_by
)
ON CONFLICT (revision_id, locale) DO UPDATE SET
  alias = EXCLUDED.alias,
  summary = EXCLUDED.summary,
  description = EXCLUDED.description,
  controls = EXCLUDED.controls,
  media_alt = EXCLUDED.media_alt,
  content_review = EXCLUDED.content_review,
  translation_method = EXCLUDED.translation_method,
  reviewed_at = EXCLUDED.reviewed_at,
  reviewed_by = EXCLUDED.reviewed_by
RETURNING *;

-- name: SetRevisionLocaleReview :exec
UPDATE game_revision_locales
SET content_review = @decision, reviewed_at = @reviewed_at, reviewed_by = @reviewed_by
WHERE revision_id = @revision_id AND locale = @locale;

-- name: ListLocaleStates :many
SELECT * FROM game_locale_states WHERE game_id = @game_id;

-- name: UpsertLocaleState :exec
INSERT INTO game_locale_states (game_id, locale, live_revision_id, first_published_at, published_at)
VALUES (@game_id, @locale, @live_revision_id, @now, @now)
ON CONFLICT (game_id, locale) DO UPDATE SET
  live_revision_id = EXCLUDED.live_revision_id,
  published_at = EXCLUDED.published_at;

-- name: DeletePublicGameRows :exec
DELETE FROM public_games WHERE game_id = @game_id;

-- name: InsertPublicGame :exec
INSERT INTO public_games (
  game_id, locale, slug, name, alias, summary, description, controls,
  primary_category, tags, developer, device_support, device_evidence_url,
  device_checked_at, source_url, source_fetched_at, cover, screenshots,
  external_url, outbound_allowed, featured, editorial_order,
  first_published_at, published_at, search_text
) VALUES (
  @game_id, @locale, @slug, @name, @alias, @summary, @description, @controls,
  @primary_category, @tags, @developer, @device_support, @device_evidence_url,
  @device_checked_at, @source_url, @source_fetched_at, @cover, @screenshots,
  @external_url, @outbound_allowed, @featured, @editorial_order,
  @first_published_at, @published_at, @search_text
);

-- name: ListGameIDsByPublishedTag :many
SELECT DISTINCT g.id
FROM games g
JOIN game_revisions r ON r.id = g.published_revision_id
WHERE g.status = 'published' AND @tag = ANY(r.tags);

-- name: ListGameNames :many
SELECT g.id, rev.name
FROM games g
JOIN game_revisions rev ON rev.id = COALESCE(g.draft_revision_id, g.published_revision_id)
WHERE g.id = ANY(@ids::uuid[]);

-- name: GetSourceGameRefByGameID :one
SELECT id, last_fetched_at, last_fetch_result
FROM source_games WHERE game_id = @game_id;

-- name: ListAdminGames :many
SELECT g.id, g.slug, g.status, g.link_status, g.outbound_disabled, g.featured,
       g.editorial_order, g.updated_at, g.link_checked_at, g.first_published_at,
       rev.name, rev.source_fetched_at, rev.material_review,
       (SELECT jsonb_object_agg(cl.locale, jsonb_build_object(
                 'contentReview', cl.content_review,
                 'live', EXISTS(SELECT 1 FROM game_locale_states s WHERE s.game_id = g.id AND s.locale = cl.locale)))
        FROM game_revision_locales cl WHERE cl.revision_id = rev.id) AS locales,
       EXISTS(SELECT 1 FROM source_changes sc WHERE sc.game_id = g.id AND sc.state = 'pending') AS has_source_changes
FROM games g
JOIN game_revisions rev ON rev.id = COALESCE(g.draft_revision_id, g.published_revision_id)
WHERE (sqlc.narg('status')::text IS NULL OR g.status = sqlc.narg('status'))
  AND (sqlc.narg('link_status')::text IS NULL OR g.link_status = sqlc.narg('link_status'))
  AND (sqlc.narg('q')::text IS NULL OR rev.name ILIKE sqlc.narg('q'))
  AND (sqlc.narg('locale')::text IS NULL OR EXISTS(
        SELECT 1 FROM game_revision_locales cl WHERE cl.revision_id = rev.id AND cl.locale = sqlc.narg('locale')))
  AND (
    sqlc.narg('review')::text IS NULL
    OR (@review = 'needs_review' AND (
          rev.material_review IN ('pending','rejected')
          OR EXISTS(SELECT 1 FROM game_revision_locales cl
                    WHERE cl.revision_id = rev.id AND cl.content_review IN ('pending','rejected'))))
    OR (@review = 'approved' AND rev.material_review NOT IN ('pending','rejected')
        AND NOT EXISTS(SELECT 1 FROM game_revision_locales cl
                       WHERE cl.revision_id = rev.id AND cl.content_review IN ('pending','rejected')))
  )
ORDER BY g.updated_at DESC, g.id
LIMIT @row_limit OFFSET @row_offset;

-- name: CountAdminGames :one
SELECT count(*)
FROM games g
JOIN game_revisions rev ON rev.id = COALESCE(g.draft_revision_id, g.published_revision_id)
WHERE (sqlc.narg('status')::text IS NULL OR g.status = sqlc.narg('status'))
  AND (sqlc.narg('link_status')::text IS NULL OR g.link_status = sqlc.narg('link_status'))
  AND (sqlc.narg('q')::text IS NULL OR rev.name ILIKE sqlc.narg('q'))
  AND (sqlc.narg('locale')::text IS NULL OR EXISTS(
        SELECT 1 FROM game_revision_locales cl WHERE cl.revision_id = rev.id AND cl.locale = sqlc.narg('locale')))
  AND (
    sqlc.narg('review')::text IS NULL
    OR (@review = 'needs_review' AND (
          rev.material_review IN ('pending','rejected')
          OR EXISTS(SELECT 1 FROM game_revision_locales cl
                    WHERE cl.revision_id = rev.id AND cl.content_review IN ('pending','rejected'))))
    OR (@review = 'approved' AND rev.material_review NOT IN ('pending','rejected')
        AND NOT EXISTS(SELECT 1 FROM game_revision_locales cl
                       WHERE cl.revision_id = rev.id AND cl.content_review IN ('pending','rejected')))
  );

-- name: ListPublishedGameIDs :many
SELECT DISTINCT g.id
FROM games g
JOIN game_locale_states s ON s.game_id = g.id
WHERE g.status = 'published';
