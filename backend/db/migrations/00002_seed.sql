-- +goose Up
-- 种子字典：15 类主类别（PRD 9.2）、24 个标签（PRD 19.2）、crawler_settings 单行。

INSERT INTO categories (slug, names, source_url, sort_order) VALUES
  ('action',    '{"en":"Action","zh":"动作"}',       'https://www.crazygames.com/c/action',    1),
  ('adventure', '{"en":"Adventure","zh":"冒险"}',    'https://www.crazygames.com/c/adventure', 2),
  ('arcade',    '{"en":"Arcade","zh":"街机"}',       'https://www.crazygames.com/c/arcade',    3),
  ('board',     '{"en":"Board","zh":"桌面棋盘"}',    'https://www.crazygames.com/c/board',     4),
  ('card',      '{"en":"Card","zh":"卡牌"}',         'https://www.crazygames.com/c/card',      5),
  ('clicker',   '{"en":"Clicker","zh":"点击"}',      'https://www.crazygames.com/c/clicker',   6),
  ('driving',   '{"en":"Driving","zh":"驾驶"}',      'https://www.crazygames.com/c/driving',   7),
  ('io',        '{"en":".io","zh":".io 类"}',        'https://www.crazygames.com/c/io',        8),
  ('puzzle',    '{"en":"Puzzle","zh":"益智解谜"}',   'https://www.crazygames.com/c/puzzle',    9),
  ('shooting',  '{"en":"Shooting","zh":"射击"}',     'https://www.crazygames.com/c/shooting',  10),
  ('sim',       '{"en":"Simulation","zh":"模拟"}',   'https://www.crazygames.com/c/sim',       11),
  ('sports',    '{"en":"Sports","zh":"体育"}',       'https://www.crazygames.com/c/sports',    12),
  ('strategy',  '{"en":"Strategy","zh":"策略"}',     'https://www.crazygames.com/c/strategy',  13),
  ('trivia',    '{"en":"Trivia","zh":"知识问答"}',   'https://www.crazygames.com/c/trivia',    14),
  ('word',      '{"en":"Word","zh":"单词文字"}',     'https://www.crazygames.com/c/word',      15);

INSERT INTO tags (slug, names) VALUES
  ('multiplayer',  '{"en":"Multiplayer","zh":"多人"}'),
  ('single-player','{"en":"Single Player","zh":"单人"}'),
  ('two-player',   '{"en":"2 Player","zh":"双人同屏"}'),
  ('pvp',          '{"en":"PvP","zh":"玩家对战"}'),
  ('co-op',        '{"en":"Co-op","zh":"合作"}'),
  ('3d',           '{"en":"3D","zh":"3D"}'),
  ('2d',           '{"en":"2D","zh":"2D"}'),
  ('pixel',        '{"en":"Pixel Art","zh":"像素风"}'),
  ('building',     '{"en":"Building","zh":"建造"}'),
  ('crafting',     '{"en":"Crafting","zh":"合成制作"}'),
  ('survival',     '{"en":"Survival","zh":"生存"}'),
  ('sandbox',      '{"en":"Sandbox","zh":"沙盒"}'),
  ('open-world',   '{"en":"Open World","zh":"开放世界"}'),
  ('idle',         '{"en":"Idle","zh":"放置"}'),
  ('tycoon',       '{"en":"Tycoon","zh":"经营大亨"}'),
  ('management',   '{"en":"Management","zh":"经营管理"}'),
  ('racing',       '{"en":"Racing","zh":"竞速"}'),
  ('parkour',      '{"en":"Parkour","zh":"跑酷"}'),
  ('obby',         '{"en":"Obby","zh":"障碍闯关"}'),
  ('stealth',      '{"en":"Stealth","zh":"潜行"}'),
  ('horror',       '{"en":"Horror","zh":"恐怖"}'),
  ('casual',       '{"en":"Casual","zh":"休闲"}'),
  ('physics',      '{"en":"Physics","zh":"物理"}'),
  ('relaxing',     '{"en":"Relaxing","zh":"解压"}');

INSERT INTO crawler_settings (id, enabled, daily_cap, min_interval_ms, hot_auto_publish)
VALUES (1, false, 3000, 2000, true);

-- +goose Down
DELETE FROM crawler_settings;
DELETE FROM tags;
DELETE FROM categories;
