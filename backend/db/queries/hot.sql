-- 热门快照批次。

-- name: InsertHotSnapshot :one
INSERT INTO hot_snapshots (source_url, source_fetched_at, cache_note, definition, observed_region, review_state, created_by)
VALUES (@source_url, @source_fetched_at, @cache_note, @definition, @observed_region, @review_state, @created_by)
RETURNING *;

-- name: InsertHotSnapshotItem :exec
INSERT INTO hot_snapshot_items (snapshot_id, position, source_slug, game_id)
VALUES (@snapshot_id, @position, @source_slug, @game_id);

-- name: ListHotSnapshots :many
SELECT * FROM hot_snapshots ORDER BY created_at DESC, id;

-- name: GetHotSnapshot :one
SELECT * FROM hot_snapshots WHERE id = @id;

-- name: SetHotSnapshotReview :one
UPDATE hot_snapshots SET review_state = @review_state WHERE id = @id RETURNING *;

-- name: DeactivateHotSnapshot :one
UPDATE hot_snapshots SET active = false WHERE id = @id RETURNING *;

-- name: GetLatestPublicHotSnapshot :one
SELECT * FROM hot_snapshots
WHERE active AND review_state = 'approved'
ORDER BY source_fetched_at DESC
LIMIT 1;

-- name: ListHotSnapshotItems :many
SELECT * FROM hot_snapshot_items WHERE snapshot_id = @snapshot_id ORDER BY position;

-- name: ListHotSnapshotGames :many
SELECT i.position, i.source_slug, pg.*
FROM hot_snapshot_items i
JOIN public_games pg ON pg.game_id = i.game_id AND pg.locale = @locale
WHERE i.snapshot_id = @snapshot_id
ORDER BY i.position;
