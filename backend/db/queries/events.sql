-- 统计事件：接收、日聚合、清理、报表。

-- name: InsertEventRaw :exec
INSERT INTO events_raw (
  event_id, event_name, game_id, source_game_id, page_type, page_path,
  locale, placement, entry_source, occurred_at, received_at
) VALUES (
  @event_id, @event_name, @game_id, @source_game_id, @page_type, @page_path,
  @locale, @placement, @entry_source, @occurred_at, @received_at
)
ON CONFLICT (event_id) DO NOTHING;

-- name: AggregateEventsRange :many
SELECT game_id, locale, event_name, count(*) AS count
FROM events_raw
WHERE received_at >= @start_at AND received_at < @end_at
GROUP BY game_id, locale, event_name;

-- name: DeleteEventsDailyDay :exec
DELETE FROM events_daily WHERE day = @day;

-- name: InsertEventsDaily :exec
INSERT INTO events_daily (day, game_id, locale, event_name, count)
VALUES (@day, @game_id, @locale, @event_name, @count);

-- name: DeleteEventsRawBefore :execrows
DELETE FROM events_raw WHERE received_at < @before;

-- name: DeleteEventsDailyBefore :execrows
DELETE FROM events_daily WHERE day < @before;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expiry < now();

-- name: StatsAggregate :many
SELECT (received_at AT TIME ZONE @tz::text)::date AS day,
       game_id, locale, event_name, count(*) AS count
FROM events_raw
WHERE received_at >= @start_at AND received_at < @end_at
  AND (sqlc.narg('game_id')::uuid IS NULL OR game_id = sqlc.narg('game_id'))
  AND (sqlc.narg('locale')::text IS NULL OR locale = sqlc.narg('locale'))
GROUP BY 1, 2, 3, 4;
