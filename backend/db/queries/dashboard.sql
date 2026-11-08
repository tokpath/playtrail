-- 后台仪表盘与导入任务。

-- name: CountGamesByStatus :many
SELECT status, count(*) AS count FROM games GROUP BY status;

-- name: CountPendingReviewGames :one
SELECT count(*)
FROM games g
JOIN game_revisions rev ON rev.id = COALESCE(g.draft_revision_id, g.published_revision_id)
WHERE rev.material_review IN ('pending','rejected')
   OR EXISTS(SELECT 1 FROM game_revision_locales cl
             WHERE cl.revision_id = rev.id AND cl.content_review IN ('pending','rejected'));

-- name: CountSuspectLinkGames :one
SELECT count(*) FROM games WHERE link_status IN ('suspect','invalid');

-- name: CountPendingSourceChanges :one
SELECT count(*) FROM source_changes WHERE state = 'pending';

-- name: GetCrawlerSettings :one
SELECT * FROM crawler_settings WHERE id = 1;

-- name: GetCrawlerQuota :one
SELECT requests FROM crawler_quota WHERE day = @day;

-- name: ListRecentSyncRuns :many
SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 10;

-- name: InsertImportJob :one
INSERT INTO import_jobs (state, payload, preview, created_by)
VALUES ('previewed', @payload, @preview, @created_by)
RETURNING *;

-- name: GetImportJob :one
SELECT * FROM import_jobs WHERE id = @id;

-- name: GetImportJobByKey :one
SELECT * FROM import_jobs WHERE import_key = @import_key;

-- name: CommitImportJob :one
UPDATE import_jobs
SET import_key = @import_key, state = 'committed', result = @result, committed_at = @committed_at
WHERE id = @id AND state = 'previewed'
RETURNING *;
