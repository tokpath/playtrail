-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- 字典
CREATE TABLE categories (
  slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{1,40}$'),
  names       jsonb NOT NULL,              -- {"en":"Action","zh":"动作"}
  source_url  text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 0
);
CREATE TABLE tags (
  slug        text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{1,40}$'),
  names       jsonb NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 素材
CREATE TABLE media_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256              text NOT NULL UNIQUE,
  width               int NOT NULL, height int NOT NULL,
  variants            jsonb NOT NULL,     -- [{"width":320,"path":"ab/abcd-320.webp"},...]
  rights_type         text NOT NULL DEFAULT 'unknown' CHECK (rights_type IN ('original','licensed','unknown')),
  rights_evidence_ref text NOT NULL DEFAULT '',
  rights_note         text NOT NULL DEFAULT '',
  review_state        text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','approved','rejected')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 游戏（身份 + 运营状态）
CREATE TABLE games (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-+[a-z0-9]+)*$' AND length(slug) <= 100),
  platform              text NOT NULL DEFAULT 'crazygames' CHECK (platform IN ('crazygames')),
  external_url          text NOT NULL UNIQUE,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','unlisted')),
  status_reason         text NOT NULL DEFAULT '',
  link_status           text NOT NULL DEFAULT 'unchecked' CHECK (link_status IN ('unchecked','valid','suspect','invalid')),
  link_checked_at       timestamptz,
  link_check_method     text NOT NULL DEFAULT '' CHECK (link_check_method IN ('','manual','crawler')),
  link_check_note       text NOT NULL DEFAULT '',
  outbound_disabled     boolean NOT NULL DEFAULT false,
  outbound_disabled_reason text NOT NULL DEFAULT '',
  featured              boolean NOT NULL DEFAULT false,
  editorial_order       int NOT NULL DEFAULT 1000 CHECK (editorial_order >= 0),
  published_revision_id uuid,             -- 共享字段的上线版本
  draft_revision_id     uuid,             -- 正在编辑的版本（null = 无待审修改）
  revision_version      int NOT NULL DEFAULT 1,   -- 乐观锁，任何 PATCH/发布 +1
  first_published_at    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_revisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id            uuid NOT NULL REFERENCES games(id),
  name               text NOT NULL,
  developer          text NOT NULL DEFAULT '',
  primary_category   text REFERENCES categories(slug),     -- 草稿可为空
  tags               text[] NOT NULL DEFAULT '{}',         -- 有序，≤8，校验在应用层
  device_support     text NOT NULL DEFAULT 'unknown' CHECK (device_support IN ('unknown','desktop','mobile','both')),
  device_evidence_url text NOT NULL DEFAULT '',
  device_checked_at  timestamptz,
  source_url         text NOT NULL,
  source_fetched_at  timestamptz NOT NULL,
  cover_asset_id     uuid REFERENCES media_assets(id),
  screenshot_asset_ids uuid[] NOT NULL DEFAULT '{}',       -- ≤5
  use_placeholder    boolean NOT NULL DEFAULT true,        -- 显式选择通用占位
  material_review    text NOT NULL DEFAULT 'placeholder' CHECK (material_review IN ('placeholder','pending','approved','rejected')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text NOT NULL                          -- admin uuid / 'import' / 'crawler'
);

CREATE TABLE game_revision_locales (
  revision_id        uuid NOT NULL REFERENCES game_revisions(id) ON DELETE CASCADE,
  locale             text NOT NULL,
  alias              text NOT NULL DEFAULT '',
  summary            text NOT NULL DEFAULT '',
  description        text NOT NULL DEFAULT '',
  controls           text NOT NULL DEFAULT '',
  media_alt          jsonb NOT NULL DEFAULT '{}',          -- {"<assetId>":"alt"}
  content_review     text NOT NULL DEFAULT 'pending' CHECK (content_review IN ('pending','approved','rejected')),
  reviewed_at        timestamptz,
  reviewed_by        uuid,
  translation_method text NOT NULL DEFAULT 'original' CHECK (translation_method IN ('original','human_translated','machine_assisted')),
  PRIMARY KEY (revision_id, locale)
);

-- 每种语言当前上线的版本
CREATE TABLE game_locale_states (
  game_id             uuid NOT NULL REFERENCES games(id),
  locale              text NOT NULL,
  live_revision_id    uuid NOT NULL REFERENCES game_revisions(id),
  first_published_at  timestamptz NOT NULL,
  published_at        timestamptz NOT NULL,
  PRIMARY KEY (game_id, locale)
);

-- 公开读模型（ADR A1）：只含 status=published 且该语言已上线的游戏
CREATE TABLE public_games (
  game_id            uuid NOT NULL,
  locale             text NOT NULL,
  slug               text NOT NULL,
  name               text NOT NULL,
  alias              text NOT NULL,
  summary            text NOT NULL,
  description        text NOT NULL,
  controls           text NOT NULL,
  primary_category   text NOT NULL,
  tags               text[] NOT NULL,
  developer          text NOT NULL,
  device_support     text NOT NULL,
  device_evidence_url text NOT NULL,
  device_checked_at  timestamptz,
  source_url         text NOT NULL,
  source_fetched_at  timestamptz NOT NULL,
  cover              jsonb,               -- 已授权封面的公开表示（Image）或 null
  screenshots        jsonb NOT NULL DEFAULT '[]',
  external_url       text NOT NULL,
  outbound_allowed   boolean NOT NULL,    -- link_status='valid' AND NOT outbound_disabled
  featured           boolean NOT NULL,
  editorial_order    int NOT NULL,
  first_published_at timestamptz NOT NULL, -- 该语言首次发布
  published_at       timestamptz NOT NULL,
  search_text        text NOT NULL,       -- lower(name || alias || summary || description || 该语言标签名)
  PRIMARY KEY (game_id, locale),
  UNIQUE (locale, slug)
);
CREATE INDEX public_games_search_trgm ON public_games USING gin (search_text gin_trgm_ops);
CREATE INDEX public_games_list ON public_games (locale, editorial_order, game_id);

-- 热门快照
CREATE TABLE hot_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url        text NOT NULL,
  source_fetched_at timestamptz NOT NULL,
  cache_note        text NOT NULL DEFAULT '',
  definition        text NOT NULL,
  observed_region   text NOT NULL,
  review_state      text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','approved','rejected')),
  active            boolean NOT NULL DEFAULT true,
  created_by        text NOT NULL,          -- admin uuid / 'system'
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hot_snapshot_items (
  snapshot_id  uuid NOT NULL REFERENCES hot_snapshots(id) ON DELETE CASCADE,
  position     int NOT NULL CHECK (position > 0),
  source_slug  text NOT NULL,               -- CrazyGames slug
  game_id      uuid REFERENCES games(id),   -- 映射到本站游戏（可空）
  PRIMARY KEY (snapshot_id, position),
  UNIQUE (snapshot_id, source_slug)
);

-- 统计
CREATE TABLE events_raw (
  event_id       uuid PRIMARY KEY,
  event_name     text NOT NULL CHECK (event_name IN ('game_view','outbound_click','related_click')),
  game_id        uuid NOT NULL,
  source_game_id uuid,
  page_type      text NOT NULL,
  page_path      text NOT NULL,
  locale         text NOT NULL,
  placement      text NOT NULL,
  entry_source   text NOT NULL,
  occurred_at    timestamptz NOT NULL,
  received_at    timestamptz NOT NULL
);
CREATE INDEX events_raw_received ON events_raw (received_at);
CREATE TABLE events_daily (
  day        date NOT NULL,               -- OPS_TIMEZONE 日期
  game_id    uuid NOT NULL,
  locale     text NOT NULL,
  event_name text NOT NULL,
  count      bigint NOT NULL,
  PRIMARY KEY (day, game_id, locale, event_name)
);

-- 管理员与会话
CREATE TABLE admins (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext NOT NULL UNIQUE,
  password_hash       text NOT NULL,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (                    -- scs pgxstore 规定的结构
  token  text PRIMARY KEY,
  data   bytea NOT NULL,
  expiry timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions (expiry);
CREATE TABLE login_attempts (
  key          text PRIMARY KEY,            -- sha256(email|ip前缀)，不存明文 IP
  count        int NOT NULL,
  window_start timestamptz NOT NULL
);

-- 操作记录
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  admin_id    uuid,                        -- null = system/crawler
  actor       text NOT NULL,               -- 'admin' | 'system' | 'crawler' | 'import'
  action      text NOT NULL,
  object_type text NOT NULL,
  object_id   text NOT NULL,
  summary     jsonb NOT NULL DEFAULT '{}',
  at          timestamptz NOT NULL DEFAULT now()
);

-- 导入
CREATE TABLE import_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_key  text UNIQUE,                 -- commit 时写入
  state       text NOT NULL CHECK (state IN ('previewed','committed','expired')),
  payload     jsonb NOT NULL,              -- 规范化后的行
  preview     jsonb NOT NULL,              -- 逐行预览结果
  result      jsonb,                       -- commit 结果
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz
);

-- 爬虫（PRD 22.11）
CREATE TABLE source_games (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id                  text UNIQUE,          -- CG game.id，取详情前为空
  slug                       text NOT NULL UNIQUE,
  name                       text NOT NULL DEFAULT '',
  category_slug              text NOT NULL DEFAULT '',
  tags                       jsonb NOT NULL DEFAULT '[]',   -- [{"slug":"battle","name":"Battle"}]
  developer                  text NOT NULL DEFAULT '',
  device_flags               jsonb NOT NULL DEFAULT '{}',   -- {"ios":true,"android":true,...}
  is_multiplayer             boolean,
  added_on                   date,
  last_significant_updated_on date,
  source_status              text NOT NULL DEFAULT '',
  rating                     numeric(4,2),
  upvotes                    bigint,
  downvotes                  bigint,
  locale_urls                jsonb NOT NULL DEFAULT '{}',   -- {"de":"https://www.crazygames.com/de/game/x",...}
  reference                  jsonb NOT NULL DEFAULT '{}',   -- 仅后台参考：descriptionFirst/Rest、controls、faq、cover、videoUrl
  raw                        jsonb,                         -- 原始 game 对象，30 天后置空
  raw_expires_at             timestamptz,
  content_hash               text NOT NULL DEFAULT '',
  parser_version             int NOT NULL DEFAULT 0,
  first_seen_at              timestamptz NOT NULL DEFAULT now(),
  last_seen_in_sitemap_at    timestamptz,
  sitemap_missing_count      int NOT NULL DEFAULT 0,
  last_fetched_at            timestamptz,
  last_fetch_result          text NOT NULL DEFAULT '',      -- ok|not_found|unpublished|redirected|blocked|error|parse_error
  consecutive_fail_days      int NOT NULL DEFAULT 0,
  game_id                    uuid UNIQUE REFERENCES games(id)
);
CREATE INDEX source_games_name_trgm ON source_games USING gin (lower(name) gin_trgm_ops);
CREATE TABLE source_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES games(id),
  field       text NOT NULL,
  old_value   jsonb, new_value jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  state       text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','ignored')),
  resolved_at timestamptz, resolved_by uuid
);
CREATE TABLE tag_mappings (
  source_tag_slug text PRIMARY KEY,
  tag_slug        text REFERENCES tags(slug)            -- null = 忽略
);
CREATE TABLE sync_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task          text NOT NULL CHECK (task IN ('sitemap','tracked','backfill','hot')),
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz,
  requests      int NOT NULL DEFAULT 0,
  status_counts jsonb NOT NULL DEFAULT '{}',
  stats         jsonb NOT NULL DEFAULT '{}',          -- new/changed/suspect/parse_errors...
  outcome       text NOT NULL DEFAULT 'running' CHECK (outcome IN ('running','ok','partial','aborted','failed')),
  abort_reason  text NOT NULL DEFAULT '',
  parser_version int NOT NULL
);
CREATE TABLE crawler_settings (            -- 单行
  id                 int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled            boolean NOT NULL,
  auto_disabled      boolean NOT NULL DEFAULT false,
  auto_disabled_reason text NOT NULL DEFAULT '',
  daily_cap          int NOT NULL,
  min_interval_ms    int NOT NULL,
  hot_auto_publish   boolean NOT NULL,
  consecutive_aborts int NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crawler_quota (
  day      date PRIMARY KEY,
  requests int NOT NULL DEFAULT 0
);

-- +goose Down
DROP TABLE crawler_quota;
DROP TABLE crawler_settings;
DROP TABLE sync_runs;
DROP TABLE tag_mappings;
DROP TABLE source_changes;
DROP TABLE source_games;
DROP TABLE import_jobs;
DROP TABLE audit_log;
DROP TABLE login_attempts;
DROP TABLE sessions;
DROP TABLE admins;
DROP TABLE events_daily;
DROP TABLE events_raw;
DROP TABLE hot_snapshot_items;
DROP TABLE hot_snapshots;
DROP TABLE public_games;
DROP TABLE game_locale_states;
DROP TABLE game_revision_locales;
DROP TABLE game_revisions;
DROP TABLE games;
DROP TABLE media_assets;
DROP TABLE tags;
DROP TABLE categories;
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pg_trgm;
