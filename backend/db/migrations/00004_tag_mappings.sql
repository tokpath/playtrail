-- +goose Up
-- PRD 22.6/22.11: 初始标签映射表——CrazyGames 标签 slug → 本站标签（明显同名的）。
-- 没有映射的 CG 标签在收录时忽略，管理员可经 PUT /admin/tag-mappings/{slug} 增补。

INSERT INTO tag_mappings (source_tag_slug, tag_slug) VALUES
  ('multiplayer',  'multiplayer'),
  ('3d',           '3d'),
  ('2d',           '2d'),
  ('pixel',        'pixel'),
  ('building',     'building'),
  ('crafting',     'crafting'),
  ('survival',     'survival'),
  ('sandbox',      'sandbox'),
  ('idle',         'idle'),
  ('tycoon',       'tycoon'),
  ('racing',       'racing'),
  ('parkour',      'parkour'),
  ('obby',         'obby'),
  ('horror',       'horror'),
  ('casual',       'casual'),
  ('physics',      'physics'),
  ('single-player','single-player'),
  ('open-world',   'open-world'),
  ('management',   'management'),
  ('stealth',      'stealth'),
  ('relaxing',     'relaxing');

-- +goose Down
DELETE FROM tag_mappings;
