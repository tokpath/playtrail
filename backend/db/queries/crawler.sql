-- 爬虫：来源目录、同步运行、配额、变更、标签映射。

-- name: UpsertSourceGameFromSitemap :one
INSERT INTO source_games (slug, locale_urls, last_seen_in_sitemap_at)
VALUES (@slug, @locale_urls, @now)
ON CONFLICT (slug) DO UPDATE SET
  locale_urls = COALESCE(sqlc.narg('locale_urls')::jsonb, source_games.locale_urls),
  last_seen_in_sitemap_at = @now,
  sitemap_missing_count = 0
RETURNING id, slug, (xmax = 0) AS inserted, first_seen_at;

-- name: MarkSourceGameSitemapMissing :one
UPDATE source_games
SET sitemap_missing_count = sitemap_missing_count + 1
WHERE slug = @slug
RETURNING sitemap_missing_count;

-- name: GetSourceGameBySlug :one
SELECT * FROM source_games WHERE slug = @slug;

-- name: GetSourceGame :one
SELECT * FROM source_games WHERE id = @id;

-- name: UpsertSourceGameDetail :one
UPDATE source_games SET
  source_id = @source_id,
  name = @name,
  category_slug = @category_slug,
  tags = @tags,
  developer = @developer,
  device_flags = @device_flags,
  is_multiplayer = @is_multiplayer,
  added_on = @added_on,
  last_significant_updated_on = @last_significant_updated_on,
  source_status = @source_status,
  rating = @rating,
  upvotes = @upvotes,
  downvotes = @downvotes,
  cover_path = @cover_path,
  reference = @reference,
  raw = @raw,
  raw_expires_at = @raw_expires_at,
  content_hash = @content_hash,
  parser_version = @parser_version,
  last_fetched_at = @last_fetched_at,
  last_fetch_result = @last_fetch_result,
  consecutive_fail_days = 0
WHERE id = @id
RETURNING *;

-- name: SetSourceGameFetchFailure :exec
UPDATE source_games SET
  last_fetched_at = @last_fetched_at,
  last_fetch_result = @last_fetch_result,
  consecutive_fail_days = CASE
    WHEN CAST(sqlc.narg('previous_fetch') AS timestamptz) IS NULL THEN 1
    WHEN last_fetched_at::date = CAST(@last_fetched_at AS timestamptz)::date THEN greatest(consecutive_fail_days, 1)
    WHEN last_fetched_at::date = (CAST(@last_fetched_at AS timestamptz) - interval '1 day')::date THEN consecutive_fail_days + 1
    ELSE 1 END
WHERE id = @id;

-- name: SetSourceGameLinkRefresh :exec
-- 22.7 row 1: refresh the checked time; the status itself is managed by the
-- caller (valid stays valid; first-time validity needs manual confirmation).
UPDATE games
SET link_checked_at = @checked_at, link_check_method = 'crawler'
WHERE id = @game_id;

-- name: SetGameSuspectByCrawler :exec
-- 22.7 row 2: suspect + CTA disabled immediately; never auto-unlist.
UPDATE games
SET link_status = 'suspect', link_check_method = 'crawler', link_check_note = @note,
    link_checked_at = @checked_at
WHERE id = @game_id;

-- name: ListCollectedSourceGames :many
SELECT sg.*, g.link_status, g.link_checked_at AS game_link_checked_at
FROM source_games sg
JOIN games g ON g.id = sg.game_id
WHERE sg.game_id IS NOT NULL
ORDER BY sg.slug;

-- name: ListSourceGamesForDetail :many
-- Missing details first, then refreshes older than 30 days (PRD 22.3).
-- Hot-list slugs from the latest snapshot (any review state) come first.
SELECT * FROM source_games
WHERE parser_version = 0 OR last_fetched_at IS NULL OR last_fetched_at < @refresh_before
ORDER BY EXISTS(
  SELECT 1 FROM hot_snapshot_items hi
  WHERE hi.snapshot_id = (SELECT id FROM hot_snapshots ORDER BY created_at DESC, id DESC LIMIT 1)
    AND hi.source_slug = source_games.slug
) DESC,
parser_version, last_fetched_at NULLS FIRST, first_seen_at
LIMIT @row_limit;

-- name: ListSourceGameIDsMissingDetail :many
SELECT id FROM source_games WHERE parser_version = 0 OR last_fetched_at IS NULL;

-- name: ListSourceGames :many
SELECT * FROM source_games
WHERE (sqlc.narg('q')::text IS NULL OR (name ILIKE '%' || @q || '%' OR slug ILIKE '%' || @q || '%'))
  AND (sqlc.narg('category')::text IS NULL OR category_slug = @category)
  AND (sqlc.narg('mobile')::boolean IS NULL OR (COALESCE((device_flags->>'ios')::boolean, false) OR COALESCE((device_flags->>'android')::boolean, false)) = @mobile)
  AND (sqlc.narg('collected')::boolean IS NULL OR (game_id IS NOT NULL) = @collected)
  AND (sqlc.narg('has_detail')::boolean IS NULL OR (parser_version > 0) = @has_detail)
ORDER BY first_seen_at DESC, slug
LIMIT @row_limit OFFSET @row_offset;

-- name: CountSourceGames :one
SELECT count(*) FROM source_games
WHERE (sqlc.narg('q')::text IS NULL OR (name ILIKE '%' || @q || '%' OR slug ILIKE '%' || @q || '%'))
  AND (sqlc.narg('category')::text IS NULL OR category_slug = @category)
  AND (sqlc.narg('mobile')::boolean IS NULL OR (COALESCE((device_flags->>'ios')::boolean, false) OR COALESCE((device_flags->>'android')::boolean, false)) = @mobile)
  AND (sqlc.narg('collected')::boolean IS NULL OR (game_id IS NOT NULL) = @collected)
  AND (sqlc.narg('has_detail')::boolean IS NULL OR (parser_version > 0) = @has_detail);

-- name: LinkSourceGamesByExternalURL :execrows
-- 22.5: link unlinked source rows to games whose external URL equals the
-- canonical CG URL of the source slug (1:1: source_games.slug and
-- games.external_url are both unique).
UPDATE source_games sg
SET game_id = g.id
FROM games g
WHERE sg.game_id IS NULL
  AND g.external_url = 'https://www.crazygames.com/game/' || sg.slug;

-- name: SetSourceGameCollected :exec
UPDATE source_games SET game_id = @game_id WHERE id = @id;

-- name: ClearExpiredSourceRaw :execrows
UPDATE source_games SET raw = NULL WHERE raw IS NOT NULL AND raw_expires_at < @now;

-- name: InsertSourceChange :exec
INSERT INTO source_changes (game_id, field, old_value, new_value)
VALUES (@game_id, @field, @old_value, @new_value);

-- name: HasUnresolvedSourceChange :one
SELECT EXISTS(SELECT 1 FROM source_changes WHERE game_id = @game_id AND field = @field AND state = 'pending') AS exists;

-- name: ListSourceChanges :many
SELECT sc.*, g.slug AS game_slug
FROM source_changes sc
JOIN games g ON g.id = sc.game_id
WHERE (sqlc.narg('state')::text IS NULL OR sc.state = @state)
ORDER BY sc.detected_at DESC, sc.id
LIMIT @row_limit OFFSET @row_offset;

-- name: CountSourceChanges :one
SELECT count(*) FROM source_changes
WHERE (sqlc.narg('state')::text IS NULL OR state = @state);

-- name: GetSourceChange :one
SELECT sc.*, g.slug AS game_slug
FROM source_changes sc
JOIN games g ON g.id = sc.game_id
WHERE sc.id = @id;

-- name: ResolveSourceChange :exec
UPDATE source_changes SET state = @state, resolved_at = @resolved_at, resolved_by = @resolved_by
WHERE id = @id;

-- name: ListTagMappings :many
SELECT * FROM tag_mappings ORDER BY source_tag_slug;

-- name: UpsertTagMapping :one
INSERT INTO tag_mappings (source_tag_slug, tag_slug)
VALUES (@source_tag_slug, @tag_slug)
ON CONFLICT (source_tag_slug) DO UPDATE SET tag_slug = EXCLUDED.tag_slug
RETURNING *;

-- name: DeleteTagMapping :exec
DELETE FROM tag_mappings WHERE source_tag_slug = @source_tag_slug;

-- name: ListTagMappingsBySourceSlugs :many
SELECT * FROM tag_mappings WHERE source_tag_slug = ANY(@slugs::text[]);

-- name: IncrementCrawlerQuota :one
INSERT INTO crawler_quota (day, requests) VALUES (@day, 1)
ON CONFLICT (day) DO UPDATE SET requests = crawler_quota.requests + 1
RETURNING requests;

-- name: InsertSyncRun :one
INSERT INTO sync_runs (task, started_at, parser_version) VALUES (@task, @started_at, @parser_version)
RETURNING *;

-- name: FinishSyncRun :exec
UPDATE sync_runs SET finished_at = @finished_at, requests = @requests,
  status_counts = @status_counts, stats = @stats, outcome = @outcome, abort_reason = @abort_reason
WHERE id = @id;

-- name: UpdateCrawlerSettings :one
UPDATE crawler_settings SET
  enabled = COALESCE(sqlc.narg('enabled'), enabled),
  daily_cap = COALESCE(sqlc.narg('daily_cap'), daily_cap),
  min_interval_ms = COALESCE(sqlc.narg('min_interval_ms'), min_interval_ms),
  hot_auto_publish = COALESCE(sqlc.narg('hot_auto_publish'), hot_auto_publish),
  auto_disabled = COALESCE(sqlc.narg('auto_disabled'), auto_disabled),
  auto_disabled_reason = COALESCE(sqlc.narg('auto_disabled_reason'), auto_disabled_reason),
  consecutive_aborts = COALESCE(sqlc.narg('consecutive_aborts'), consecutive_aborts),
  updated_at = now()
WHERE id = 1
RETURNING *;

-- name: GetSyncRun :one
SELECT * FROM sync_runs WHERE id = @id;

-- name: CountPendingSourceChangesForGame :one
SELECT count(*) FROM source_changes WHERE game_id = @game_id AND state = 'pending';
