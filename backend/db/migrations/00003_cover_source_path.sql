-- +goose Up
-- PRD 22.12 / ARCHITECTURE A13: hotlinked CrazyGames covers.

ALTER TABLE game_revisions
  ADD COLUMN cover_source_path text NOT NULL DEFAULT ''
  CHECK (cover_source_path = '' OR (cover_source_path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$' AND length(cover_source_path) <= 200 AND position('..' in cover_source_path) = 0));

ALTER TABLE source_games
  ADD COLUMN cover_path text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE source_games DROP COLUMN cover_path;
ALTER TABLE game_revisions DROP COLUMN cover_source_path;
