-- 素材、审计、管理员、登录限速。

-- name: InsertMediaAsset :one
INSERT INTO media_assets (sha256, width, height, variants)
VALUES (@sha256, @width, @height, @variants)
RETURNING *;

-- name: GetMediaAsset :one
SELECT * FROM media_assets WHERE id = @id;

-- name: GetMediaAssetBySHA256 :one
SELECT * FROM media_assets WHERE sha256 = @sha256;

-- name: ListMediaAssets :many
SELECT * FROM media_assets WHERE id = ANY(@ids::uuid[]);

-- name: UpdateMediaAsset :one
UPDATE media_assets SET
  rights_type = COALESCE(sqlc.narg('rights_type'), rights_type),
  rights_evidence_ref = COALESCE(sqlc.narg('rights_evidence_ref'), rights_evidence_ref),
  rights_note = COALESCE(sqlc.narg('rights_note'), rights_note),
  review_state = COALESCE(sqlc.narg('review_state'), review_state)
WHERE id = @id
RETURNING *;

-- name: InsertAuditLog :exec
INSERT INTO audit_log (admin_id, actor, action, object_type, object_id, summary)
VALUES (@admin_id, @actor, @action, @object_type, @object_id, @summary);

-- name: ListAuditLog :many
SELECT * FROM audit_log ORDER BY id DESC LIMIT @row_limit OFFSET @row_offset;

-- name: CountAuditLog :one
SELECT count(*) FROM audit_log;

-- name: InsertAdmin :one
INSERT INTO admins (email, password_hash)
VALUES (@email::citext, @password_hash)
RETURNING id, email::text AS email, password_hash, password_changed_at, created_at;

-- name: GetAdminByEmail :one
SELECT id, email::text AS email, password_hash, password_changed_at, created_at
FROM admins WHERE email = @email::citext;

-- name: GetAdmin :one
SELECT id, email::text AS email, password_hash, password_changed_at, created_at
FROM admins WHERE id = @id;

-- name: UpdateAdminPassword :one
UPDATE admins SET password_hash = @password_hash, password_changed_at = @changed_at
WHERE id = @id
RETURNING id, email::text AS email, password_hash, password_changed_at, created_at;

-- name: GetLoginAttempt :one
SELECT * FROM login_attempts WHERE key = $1;

-- name: UpsertLoginAttempt :exec
INSERT INTO login_attempts (key, count, window_start)
VALUES (@key, 1, @now)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN login_attempts.window_start < @cutoff
               THEN 1 ELSE login_attempts.count + 1 END,
  window_start = CASE WHEN login_attempts.window_start < @cutoff
               THEN @now ELSE login_attempts.window_start END;

-- name: DeleteLoginAttempt :exec
DELETE FROM login_attempts WHERE key = $1;
