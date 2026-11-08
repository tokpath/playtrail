# PlayTrail 架构设计（实现基线）

> 依据：[PRD v1.1](PRD-v1.1.md)、[TECH-STACK](TECH-STACK.md)、[DESIGN](DESIGN.md)。本文是实现的约束性基线：实现者不得偏离；发现本文与 PRD 冲突、或本文有遗漏时，停下来在交付报告里提出，不要自行发明。
> 状态：v1，2026-11-08，架构负责人 Opus。

## 0. 关键决策（ADR 摘要）

| # | 决策 | 理由 |
| --- | --- | --- |
| A1 | **公开读模型 `public_games`**：每个"已上线的 (游戏, 语言)"一行，所有公开接口只读这张表 | 草稿、审核材料在物理上不可能从公开接口泄露（E09）；查询简单 |
| A2 | 读模型在**同一事务内**由写操作重建（发布、下架、关/开 CTA、链接状态变化、字典改名） | 满足"60 秒内一致"且无需后台任务 |
| A3 | 内容版本化：`game_revisions`（共享字段）+ `game_revision_locales`（语言字段）；每种语言独立指向自己上线的 revision | 支持"部分语言发布，其余语言保持原状"（PRD 7.1） |
| A4 | `external_url` 和 `slug` 放在 `games` 上，首次发布后不可修改 | PRD 8.1 slug 不变；链接状态是针对 URL 的运营状态 |
| A5 | 迁移用 goose **库**（嵌入二进制），`playtrail migrate` 子命令；不依赖 goose CLI | 本机无 goose CLI，部署更简单 |
| A6 | 图片编码用纯 Go 的 `github.com/gen2brain/webp`（无 cgo） | Docker 镜像简单，`CGO_ENABLED=0` 静态二进制 |
| A7 | 前端样式用 **Tailwind CSS v4**，设计令牌在 `@theme` 中定义（见 DESIGN.md） | 令牌集中，组件风格一致 |
| A8 | 开发环境不需要 Caddy：Next.js `rewrites` 把 `/api/*`、`/media/*` 转给 Go；生产由 Caddy 分流，行为等价 | 本地一条命令起前后端 |
| A9 | 游戏封面在没有授权图片时，用**确定性生成的原创封面**（SVG，种子 = slug），见 DESIGN.md §5 | 无素材也能做出精美、可区分的卡片；不碰第三方美术 |
| A10 | 详情页、首页数据走服务端渲染 + Next 数据缓存（`revalidate: 30` + tag），Go 写操作后调用 web 内部失效接口；即使失效调用失败，30 秒 TTL 仍保证 60 秒一致 | PRD 7.1 |
| A11 | 410 由 Next 的 proxy（Next 16 起 `middleware.ts` 更名为 `proxy.ts`，以实际版本文档为准）识别已下架 slug 后改写到返回 410 的 route handler | App Router 页面不能直接返回 410 |
| A13 | 封面热链 CrazyGames 图片 CDN（PRD 22.12）：revision 存 `cover_source_path`，读模型重建时按固定模板拼出公开 `Image`；全站开关 `EXTERNAL_COVERS_ENABLED` 在重建时生效（切换后执行 `playtrail rebuild-public`） | 零存储；URL 只由服务端模板生成，主机固定 |
| A12 | 字体：允许**一个**自托管展示字体（Bricolage Grotesque，`next/font` 构建时下载、自托管、`display: swap`、只取 Latin 子集），正文用系统字体栈 | 美感需要；不产生运行时第三方请求。PRD 12.9 已同步修订 |

## 1. 仓库结构

```
playtrail/
├─ Makefile                 dev-db / api / web / crawl-fake / e2e / up / down / seed
├─ api/openapi.yaml         接口契约，必须与本文 §6 完全一致
├─ backend/                 Go module: playtrail/backend
│  ├─ cmd/playtrail/        main.go：子命令 serve | worker | migrate | seed | admin-create | rebuild-public | crawl
│  ├─ internal/
│  │  ├─ config/            环境变量解析（§2）
│  │  ├─ db/                pgxpool、事务助手、sqlc 生成代码（db/sqlc）
│  │  ├─ clock/             Clock 接口；e2e build tag 提供可设置时钟
│  │  ├─ httpx/             路由、中间件（requestId、recover、日志、no-store）、错误输出
│  │  ├─ validate/          所有字段规则（长度按码点、白名单 URL、枚举、时间）
│  │  ├─ auth/              scs 会话、argon2id、登录限速、CSRF（http.CrossOriginProtection）
│  │  ├─ catalog/           游戏、revision、发布门禁、读模型重建、相关推荐
│  │  ├─ dict/              类别、标签
│  │  ├─ hot/               热门快照
│  │  ├─ imports/           JSON 导入
│  │  ├─ media/             上传、校验、WebP 多尺寸
│  │  ├─ events/            事件接收、聚合、清理、统计
│  │  ├─ audit/             操作记录
│  │  ├─ crawler/           robots、sitemap、游戏页解析、调度、熔断、来源目录
│  │  ├─ revalidate/        调用 web 内部失效接口
│  │  └─ api/               handler（public / admin），只做编解码和调用领域层
│  └─ db/migrations/        goose SQL 迁移；db/queries/ sqlc 查询；sqlc.yaml
├─ web/                     Next.js（App Router，TS strict，Tailwind v4，next-intl）
├─ e2e/                     Playwright + fake-crazygames（Go 小服务 + 页面样本）
├─ deploy/                  docker-compose.yml、docker-compose.dev.yml、Caddyfile、backup.sh
└─ docs/
```

## 2. 运行时与配置

| 服务 | 端口（本地） | 说明 |
| --- | --- | --- |
| postgres | 5432（dev compose 映射 55432，避免与本机 PG 冲突） | PostgreSQL 17 |
| api | 8081 | `playtrail serve` |
| worker | — | `playtrail worker`（定时任务 + 爬虫调度） |
| web | 3000 | Next.js |
| fake-crazygames | 8090 | 仅 e2e / 本地开发 |
| caddy | 8080（本地）/ 80,443（生产） | 仅完整 compose |

环境变量（Go，全部有 `.env.example`）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | — | 必填 |
| `API_ADDR` | `:8081` | |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | 生成绝对 URL、CSRF 可信来源 |
| `WEB_INTERNAL_URL` | `http://localhost:3000` | 调用失效接口 |
| `INTERNAL_SECRET` | — | 必填，≥32 字节；Go ↔ web 内部调用 |
| `MEDIA_DIR` | `./data/media` | |
| `OPS_TIMEZONE` | `Asia/Taipei` | 统计计日 |
| `SUPPORTED_LOCALES` | `en,zh` | |
| `DEFAULT_LOCALE` | `en` | |
| `LOCALE_MIN_GAMES` | `10` | 某语言已上线游戏数 ≥ 此值才算"已上线语言" |
| `SESSION_IDLE_TIMEOUT` | `30m` | |
| `TRUSTED_PROXY_HEADER` | —（空） | 可信代理携带真实客户端 IP 的请求头（生产为 `CF-Connecting-IP`）；仅对来自回环/私网地址的请求生效，值必须是单个合法 IP |
| `CRAWLER_ENABLED` | `false` | 部署层总开关 |
| `CRAWLER_USER_AGENT` | `PlayTrailBot/1.0 (+{PUBLIC_BASE_URL}/en/about)` | |
| `CRAWLER_DAILY_CAP` | `3000` | |
| `CRAWLER_MIN_INTERVAL` | `2s` | 另加 0–1s 抖动 |
| `CRAWLER_OBSERVED_REGION` | `TW` | |
| `HOT_AUTO_PUBLISH` | `true` | 初始值，之后以 `crawler_settings` 为准 |
| `EXTERNAL_COVERS_ENABLED` | `true` | PRD 22.12 全站开关；改动后运行 `playtrail rebuild-public` |

web 变量：`API_INTERNAL_URL`（默认 `http://localhost:8081`）、`PUBLIC_BASE_URL`、`INTERNAL_SECRET`、`SUPPORTED_LOCALES`、`DEFAULT_LOCALE`。

## 3. 数据库（初始迁移的约束性定义）

规则：所有时间 `timestamptz`；id 用 `uuid DEFAULT gen_random_uuid()`；枚举用 `text + CHECK`（便于迁移）；每张表的约束写在 DDL 里，不只靠应用层。

```sql
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
  tags               text[] NOT NULL DEFAULT '{}',         -- 有序，≤8，校验在应用层+触发器可选
  device_support     text NOT NULL DEFAULT 'unknown' CHECK (device_support IN ('unknown','desktop','mobile','both')),
  device_evidence_url text NOT NULL DEFAULT '',
  device_checked_at  timestamptz,
  source_url         text NOT NULL,
  source_fetched_at  timestamptz NOT NULL,
  cover_asset_id     uuid REFERENCES media_assets(id),
  cover_source_path  text NOT NULL DEFAULT '' CHECK (cover_source_path = '' OR (cover_source_path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$' AND length(cover_source_path) <= 200 AND position('..' in cover_source_path) = 0)),
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
  cover              jsonb,               -- 已授权封面的公开表示（§6 Image）或 null
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
  cover_path                 text NOT NULL DEFAULT '',      -- CG game.cover（16:9），收录时写入 cover_source_path
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
```

种子迁移：15 类类别（PRD 9.2）、24 个标签（PRD 19.2）、`crawler_settings` 一行。

## 4. 领域规则（必须在服务端实现）

### 4.1 编辑与版本

- `POST /admin/games` 创建 `games` + 第一个 revision（`draft_revision_id` 指向它）。
- `PATCH`：请求必须带 `revisionVersion`，与 `games.revision_version` 不等 → 409 `REVISION_CONFLICT`。`draft_revision_id` 为空时先**复制**当前 published revision（含全部语言行）作为新草稿再修改。成功后 `revision_version+1`。
- 修改某语言的 `alias/summary/description/controls/media_alt` → 该语言 `content_review` 重置为 `pending`。修改素材 → `material_review` 重新计算（无素材且 `use_placeholder` → `placeholder`，否则 `pending`，全部素材 approved 后由管理员设 `approved`）。
- `slug`、`external_url` 在 `first_published_at` 非空后禁止修改（422）。

### 4.2 发布门禁（`POST /admin/games/{id}/publish`）

输入：`revisionVersion`，`locales`（可选，默认全部满足语言级门禁的语言）。候选 revision = `draft_revision_id`（若空则 published revision，用于"已下架后重新发布"或"只追加语言"）。

游戏级门禁（任一失败 → 422 `PUBLISH_GATE_FAILED`，`fieldErrors` 逐项）：
1. `name` 1–150；`primary_category` 存在；`tags` ≤8、不重复、全部 active；`source_url` https；`source_fetched_at` ≤ now 且 ≥ now−7d。
2. `link_status='valid'` 且 `link_checked_at` ≥ now−7d。
3. 素材：`material_review IN ('placeholder','approved')`；若 `placeholder` 则 `use_placeholder=true`；所有引用素材 `rights_type IN ('original','licensed')` 且 `review_state='approved'`。
4. `device_support != 'unknown'` 时 `device_evidence_url` 非空且 `device_checked_at` 非空。

语言级门禁（每个请求的语言）：`summary`/`description` 长度符合 PRD 8.2（按码点）；`controls` ≤ 上限；`content_review='approved'`；主类别和所有标签在该语言有名字；每个已用素材有该语言 alt。

通过后在一个事务内：`published_revision_id = 候选`；`draft_revision_id = null`；通过门禁的语言 upsert `game_locale_states`（首次写入时设 `first_published_at`）；`status='published'`；首次发布设 `games.first_published_at`；`revision_version+1`；重建该游戏的 `public_games`；写 `audit_log`；事务提交后调用失效（§7）。请求了但未通过的语言出现在 `fieldErrors`，若**没有任何**语言通过 → 整体 422，不做任何修改。

### 4.3 读模型重建 `rebuildPublicGame(tx, gameID)`

删除该游戏全部 `public_games` 行；若 `status='published'`：对每个 `game_locale_states` 行，用 published revision 的共享字段 + `live_revision_id` 的该语言字段生成一行。`cover` 按优先级生成：封面素材 rights 合格且 approved → 本站素材 Image；否则 `cover_source_path` 非空且 `EXTERNAL_COVERS_ENABLED` → CrazyGames Image（`url`/`srcset` 按 PRD 22.12 模板，宽 320/640/1280，`width:1280,height:720`，`alt` = 该语言 alias 或游戏名）；否则 null。`Image` 增加 `source: "self"|"crazygames"`，前端据此决定 `referrerpolicy` 和分享图。`outbound_allowed = link_status='valid' AND NOT outbound_disabled`。字典改名后对引用它的所有游戏重建（`search_text` 含标签名）。

### 4.4 已上线语言

`liveLocales = { l ∈ SUPPORTED_LOCALES | count(public_games where locale=l) ≥ LOCALE_MIN_GAMES }`，缓存 30 秒。公开接口 `GET /api/meta` 返回 `supportedLocales`、`liveLocales`。未上线语言的页面仍可访问（200 + noindex），语言切换器和 `Accept-Language` 跳转只用 `liveLocales`；若 `liveLocales` 为空则跳转用 `DEFAULT_LOCALE`。

### 4.5 相关游戏

严格按 PRD 18.2；在详情接口内计算（≤1000 款，直接 SQL：同语言 `public_games` 中 `outbound_allowed`，score = 3*同主类 + 共同标签数，`score>=1`，`ORDER BY score DESC, editorial_order, game_id LIMIT 6`）。

### 4.6 搜索与列表

`q`：trim，空 → 无关键词；>80 码点 → 400；`lower(q)` 转义 `\ % _` 后 `search_text LIKE '%'||q||'%' ESCAPE '\'`。`category`/`tag` 必须是存在的 slug，否则 400。`sort=editorial`：`editorial_order, game_id`；`newest`：`first_published_at DESC, game_id`。分页越界 → 空 items + 真实 total。

### 4.7 热门

公开 `GET /api/hot`：取 `active AND review_state='approved'` 的最新批次（按 `source_fetched_at DESC`）；`stale = now > source_fetched_at + 48h`；条目 JOIN `public_games`（同语言），保留原 position。首页聚合接口在 `stale` 时不返回 hot。

### 4.8 事件

`POST /api/events`：严格 JSON（`DisallowUnknownFields`），字段白名单、枚举校验，`gameId` 必须存在于 `public_games`（同语言）；`received_at = clock.Now()`；`INSERT … ON CONFLICT DO NOTHING`；返回 202。限流：按 IP 的令牌桶（内存，IP 不落盘）超限 429。worker 每 10 分钟把 `received_at` 在今日/昨日（OPS_TIMEZONE）的原始事件聚合 upsert 到 `events_daily`（幂等：按天全量重算）；每天清理 `events_raw` >30 天、`events_daily` >90 天。

### 4.9 爬虫

严格按 PRD 第 22 节。补充实现约束：
- 基础 URL 常量 `https://www.crazygames.com`；只有 `e2e` build tag 的构建可用 `CRAWLER_BASE_URL` 覆盖。
- 调度在 worker 内：每分钟检查一次到期任务；用 `pg_try_advisory_lock` 防并发；每个任务一条 `sync_runs`。
- 熔断状态（每次运行的 403/429 计数、`consecutive_aborts`）落库。
- 游戏页解析：提取 `<script id="__NEXT_DATA__" type="application/json">`，解码到只含白名单字段的结构体（`props.pageProps.game`）；失败 → JSON-LD `ItemPage` 兜底（只能拿到 name/url）；仍失败 → `parse_error`。
- `/hot` 的结构在实现时用一次人工请求确认（同样在 `__NEXT_DATA__` 中，取页面顺序前 20 个游戏 slug），并把样本存入 `e2e/fake-crazygames/samples/`。
- 收录（`POST /admin/source-games/{id}/collect`）：创建游戏草稿，`external_url = https://www.crazygames.com/game/{slug}`，`source_url` 同上，`source_fetched_at = last_fetched_at`，`name/developer/primary_category/tags/device_*` 按 PRD 22.6 预填，`cover_source_path = source_games.cover_path`，各语言行为空、`pending`。

## 5. 安全

- 管理接口：scs 会话（cookie `pt_session`，HttpOnly、Secure（生产）、SameSite=Lax、Path=/），空闲 30 分钟；登录成功 `RenewToken`；改密删除该管理员全部会话（会话数据里存 admin id + `password_changed_at`，每次请求比对，旧会话失效）。
- CSRF：`http.CrossOriginProtection` 包住所有非 GET 的 `/api/admin/*` 和 `/api/events`；可信来源 = `PUBLIC_BASE_URL`。
- 登录限速：同一 key 15 分钟 10 次失败 → 429。
- 所有管理接口响应 `Cache-Control: no-store`；公开 GET `Cache-Control: public, max-age=0, s-maxage=30`。
- 上传：≤2 MB（`http.MaxBytesReader`），嗅探真实类型只接受 JPEG/PNG/WebP，解码后重新编码为 WebP（320/640/1280 宽，不放大），文件名 `{sha256[:2]}/{sha256}-{w}.webp`；Go 以 `/media/*` 提供（`Cache-Control: public, max-age=31536000, immutable`，`X-Content-Type-Options: nosniff`）。
- 日志：slog JSON，字段 requestId/method/path/status/duration；不记录 cookie、Authorization、请求体、IP。

## 6. 接口契约（`api/openapi.yaml` 必须与此一致）

所有路径前缀 `/api`。公开接口必须带 `locale`（∈ SUPPORTED_LOCALES，否则 400）。JSON 字段 camelCase；时间 RFC 3339 带偏移。

### 6.1 共享类型（TypeScript 记法）

```ts
type Locale = "en" | "zh";
type ErrorBody = { code: ErrorCode; message: string; fieldErrors?: Record<string, string>; requestId: string };
type ErrorCode = "INVALID_PARAM"|"VALIDATION_FAILED"|"UNAUTHENTICATED"|"FORBIDDEN"|"NOT_FOUND"|"GONE"
  |"REVISION_CONFLICT"|"PAYLOAD_TOO_LARGE"|"UNSUPPORTED_MEDIA_TYPE"|"PUBLISH_GATE_FAILED"|"RATE_LIMITED"|"INTERNAL_ERROR";
type Ref = { slug: string; name: string };                    // 类别/标签，name 为该语言名
type Image = { url: string; width: number; height: number; alt: string;
               srcset: { url: string; width: number }[];        // url 为最大档
               source: "self" | "crazygames";
               shareUrl: string };                              // 1200×630 分享图 URL
type GameCard = { id: string; slug: string; name: string; alias: string; summary: string;
                  primaryCategory: Ref; tags: Ref[];            // 卡片最多 3 个
                  cover: Image | null; outboundAllowed: boolean };
type GameDetail = GameCard & {
  tags: Ref[];                                                  // 全部（≤8）
  description: string; controls: string;                        // controls 可为 ""
  developer: string;                                            // 可为 ""
  deviceSupport: "unknown"|"desktop"|"mobile"|"both";
  deviceEvidence: { url: string; checkedAt: string } | null;
  sourceUrl: string; sourceFetchedAt: string;
  screenshots: Image[];
  ctaUrl: string;                                               // 按 PRD 22.8 派生
  outboundAllowed: boolean;
  outboundBlockedReason: "link_unavailable" | null;
  availableLocales: Locale[];                                   // 该游戏已上线的语言
  firstPublishedAt: string; publishedAt: string;
  related: GameCard[];                                          // ≤6
};
type HotSnapshot = { snapshotId: string; sourceUrl: string; sourceFetchedAt: string; observedRegion: string;
                     definition: string; stale: boolean;
                     items: { position: number; game: GameCard }[] };
type CategoryCount = Ref & { count: number; sortOrder: number };
type TagCount = Ref & { count: number };
```

### 6.2 公开接口

| 方法 路径 | 参数 | 200 响应 | 错误 |
| --- | --- | --- | --- |
| GET `/meta` | — | `{ supportedLocales: Locale[], liveLocales: Locale[], defaultLocale: Locale }` | |
| GET `/home` | locale | `{ featured: GameCard[] /*≤12*/, hot: HotSnapshot\|null /*stale 时 null，items≤20*/, categories: CategoryCount[] /*count>0*/ , totalGames: number, updatedAt: string\|null /*该语言已上线游戏的最新 published_at*/ }` | 400 |
| GET `/games` | locale, q, category, tag, sort=`editorial\|newest`, page≥1, pageSize 1–48 默认 24 | `{ items: GameCard[], total, page, pageSize, totalPages, appliedFilters: { q: string\|null, category: string\|null, tag: string\|null, sort } }` | 400 |
| GET `/games/{slug}` | locale | `GameDetail` | 404（不存在/草稿/该语言未上线）、410（unlisted） |
| GET `/categories` | locale | `{ items: CategoryCount[] }`（只含 count>0） | 400 |
| GET `/categories/{slug}` | locale | `{ category: CategoryCount /*count 可为 0*/ }` | 404 未知类别 |
| GET `/tags` | locale | `{ items: TagCount[] }`（count>0） | 400 |
| GET `/hot` | locale | `{ snapshot: HotSnapshot \| null }` | 400 |
| GET `/sitemap` | locale | `{ games: { slug, updatedAt, locales: Locale[] }[], categories: { slug, locales: Locale[] }[] }` | 400 |
| GET `/unlisted-slugs` | — | `{ slugs: string[] }` | 仅供 web proxy 判断 410 |
| POST `/events` | body 见 PRD 11 + 附录 B | 202 空 | 400、429 |

### 6.3 管理接口（全部需会话；未登录 401，CSRF 失败 403）

| 方法 路径 | 请求 | 响应 |
| --- | --- | --- |
| POST `/admin/login` | `{ email, password }` | 204 + Set-Cookie；401；429 |
| POST `/admin/logout` | — | 204 |
| GET `/admin/me` | — | `{ id, email }` |
| POST `/admin/password` | `{ currentPassword, newPassword /*≥12*/ }` | 204，撤销全部会话 |
| GET `/admin/dashboard` | — | `{ counts: {draft, published, unlisted, pendingReview, suspectLinks, sourceChangesPending}, liveLocales, crawler: CrawlerStatus, hot: {sourceFetchedAt, stale}\|null }` |
| GET `/admin/games` | status, linkStatus, review=`needs_review\|approved`, locale, q, page, pageSize | `{ items: AdminGameRow[], total, page, pageSize, totalPages }` |
| POST `/admin/games` | `{ name, externalUrl, sourceUrl, sourceFetchedAt, slug?, primaryCategory?, tags? }` | 201 `AdminGame` |
| GET `/admin/games/{id}` | — | `AdminGame` |
| PATCH `/admin/games/{id}` | `{ revisionVersion, slug?, externalUrl?, name?, developer?, primaryCategory?, tags?, deviceSupport?, deviceEvidenceUrl?, deviceCheckedAt?, sourceUrl?, sourceFetchedAt?, coverAssetId?, coverSourcePath?, screenshotAssetIds?, usePlaceholder?, materialReview?, featured?, editorialOrder?, locales?: { [l]: { alias?, summary?, description?, controls?, mediaAlt?, translationMethod? } } }` | `AdminGame`；409；422 |
| POST `/admin/games/{id}/locales/{locale}/review` | `{ revisionVersion, decision: "approved"\|"rejected", confirmOriginal: true, confirmFactsVerified: true }` | `AdminGame` |
| POST `/admin/games/{id}/link-check` | `{ status: "valid"\|"suspect"\|"invalid", note }` | `AdminGame`（method=manual，checkedAt=now） |
| GET `/admin/games/{id}/gates` | locales? | `GateReport` |
| POST `/admin/games/{id}/publish` | `{ revisionVersion, locales?: Locale[] }` | `AdminGame`；422 `PUBLISH_GATE_FAILED` |
| POST `/admin/games/{id}/unlist` | `{ reason /*1–500*/ }` | `AdminGame` |
| POST `/admin/games/{id}/outbound` | `{ enabled: boolean, reason }` | `AdminGame` |
| GET `/admin/games/{id}/preview` | locale | `GameDetail`（草稿版本；`Cache-Control: no-store`） |
| POST `/admin/media` | multipart `file` | 201 `MediaAsset` |
| PATCH `/admin/media/{id}` | `{ rightsType?, rightsEvidenceRef?, rightsNote?, reviewState? }` | `MediaAsset` |
| GET `/admin/categories` · PATCH `/admin/categories/{slug}` | `{ names?, sortOrder? }` | 完整字典 |
| GET `/admin/tags` · POST `/admin/tags` · PATCH `/admin/tags/{slug}` | `{ slug, names }` / `{ names?, active? }` | |
| GET `/admin/hot-snapshots` · POST `/admin/hot-snapshots` | `{ sourceUrl, sourceFetchedAt, observedRegion, definition, cacheNote, items: {position, sourceSlug}[] }` | |
| POST `/admin/hot-snapshots/{id}/review` · `/deactivate` | `{ decision }` / — | |
| POST `/admin/imports/preview` | `application/json` 导入文件（≤1 MB） | `{ previewId, rows: ImportRow[], summary }` |
| POST `/admin/imports/commit` | `{ previewId, importKey }` | `{ jobId, rows: ImportRow[], summary }`（重复 key 返回原结果） |
| GET `/admin/imports/{id}` | — | 同上 |
| GET `/admin/stats` | from, to（YYYY-MM-DD，≤90 天）, gameId?, locale? | `{ days: { day, gameViews, outboundClicks, relatedClicks }[], totals, byGame: {gameId, name, gameViews, outboundClicks, ctr}[] , notes: string }` |
| GET `/admin/audit` | page | `{ items, total, ... }` |
| GET `/admin/source-games` | q, category, mobile, collected, detail=`yes\|no`, page | `{ items: SourceGameRow[], total, ... }` |
| GET `/admin/source-games/{id}` | — | `SourceGame`（含 reference） |
| POST `/admin/source-games/{id}/collect` | — | 201 `AdminGame` |
| GET `/admin/source-changes` · POST `/admin/source-changes/{id}/resolve` | `{ action: "accept"\|"ignore", revisionVersion? }` | accept 写入草稿 revision |
| GET `/admin/tag-mappings` · PUT `/admin/tag-mappings/{sourceTagSlug}` | `{ tagSlug: string\|null }` | |
| GET `/admin/crawler` | — | `CrawlerStatus = { enabledEnv, enabled, autoDisabled, autoDisabledReason, dailyCap, minIntervalMs, hotAutoPublish, quotaToday, runs: SyncRun[] }` |
| PATCH `/admin/crawler` | `{ enabled?, dailyCap?, minIntervalMs? /*≥2000*/, hotAutoPublish? }`（`enabled=true` 同时清除 autoDisabled） | `CrawlerStatus` |
| POST `/admin/crawler/run` | `{ task: "sitemap"\|"tracked"\|"backfill"\|"hot" }` | 202 |

`AdminGame` = `games` 运营字段 + `draft`（或无草稿时 published）revision 的共享字段 + `locales: { [l]: {alias, summary, description, controls, mediaAlt, contentReview, translationMethod, reviewedAt, live: boolean, liveRevisionId, firstPublishedAt, publishedAt} }` + `hasPendingChanges` + `gates: GateReport` + `source: { sourceGameId, lastFetchedAt, lastFetchResult } | null`。
`GateReport = { game: { ok: boolean, failures: { field, message }[] }, locales: { [l]: { ok, failures } } }`。
`AdminGameRow` = id, slug, name, status, linkStatus, outboundDisabled, featured, editorialOrder, updatedAt, sourceFetchedAt, linkCheckedAt, locales: {[l]: {contentReview, live}}, risks: string[]（如 `link_check_stale`、`source_changed`）。

## 7. 缓存失效

Go 在发布/下架/CTA/链接状态/字典/快照变更**提交后**，异步（超时 2 秒，失败只记日志）POST `{WEB_INTERNAL_URL}/_internal/revalidate`，头 `X-Internal-Secret`，体 `{ tags: string[] }`。tag 约定：`games`（全部列表/首页/sitemap）、`game:{slug}`、`hot`、`dict`。web 端 `fetch` 时打相同 tag，`revalidate: 30`。Caddy 生产配置拒绝外部访问 `/_internal/*`。

## 8. 前端结构

```
web/
├─ app/
│  ├─ [locale]/
│  │  ├─ layout.tsx               html lang、字体、Header/Footer、hreflang 公共部分
│  │  ├─ page.tsx                 首页
│  │  ├─ games/page.tsx           列表（noindex）
│  │  ├─ games/[slug]/page.tsx    详情
│  │  ├─ games/[slug]/opengraph-image.tsx   每款游戏的原创分享图
│  │  ├─ categories/[slug]/page.tsx
│  │  ├─ hot/page.tsx
│  │  ├─ about|privacy|copyright/page.tsx   内容来自 messages（法律页文案标注"待需求方确认"）
│  │  └─ not-found.tsx
│  ├─ admin/                      后台（中文，client 组件为主，调用 /api/admin/*）
│  ├─ gone/route.ts               410 HTML（被 proxy 改写到此）
│  ├─ _internal/revalidate/route.ts
│  ├─ sitemap.xml / sitemap-[locale].xml / robots.txt 路由
├─ proxy.ts（或 middleware.ts）    Accept-Language 跳转（PRD 4.2）+ 410 改写
├─ components/                    ui/（Button、Chip、Pill…）、game/（GameCard、TrailCover…）、layout/
├─ lib/api/                       server.ts（服务端 fetch + tag）、client.ts（浏览器）、types.ts（由 openapi-typescript 生成）
├─ lib/i18n/                      locale 工具、Accept-Language 解析（纯函数）
├─ lib/analytics.ts               sendBeacon 上报、DNT/GPC 判断、entrySource 传递（sessionStorage 中只存本次导航来源，不算持久跟踪；或用 URL state）
└─ messages/en.json, zh.json
```

- entrySource 传递：站内链接点击时把来源写入 `sessionStorage['pt_entry']`（单值、下一次详情页读取后立即删除），不写 cookie；无值 → `direct_or_unknown`。
- 所有页面 `generateMetadata` 输出 title、description、canonical、alternates.languages（只列该页面实际已上线的语言 + x-default）、openGraph、twitter、robots。

## 9. 测试与交付

- **只写 E2E**（Playwright），覆盖 PRD E01–E27；不写单元测试。fake-crazygames 规则见 TECH-STACK §5。
- E2E 运行在本机进程上（2026-11-09 修订：e2e 构建的爬虫只允许访问 loopback 地址，见 crawler-r2 C5）：独立数据库 `playtrail_e2e`（dev compose 的 postgres）+ api（e2e build tag）+ web（生产构建）+ fake-crazygames，全部监听 127.0.0.1，由 `make e2e` 启停；种子数据由 `playtrail seed --fixture e2e` 写入；时钟通过 `POST /api/_test/clock`（仅 e2e 构建存在）控制。
- 产物：`e2e/report/`（HTML 报告、trace、截图），作为可重复验证的证据。
- 质量门：`go vet`、`golangci-lint run`、`gofmt -l` 为空；`pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。

## 10. 实现者质量要求（每个实现任务都适用）

- **设计**：代码放在正确的层（handler 只编解码；规则在领域包；SQL 在 sqlc 查询），复用已有助手，不加多余抽象、开关和特例。
- **可读性**：与周边代码的命名、惯用法、结构、注释密度一致；函数聚焦；行宽合理；import 放在文件常规位置。
- **范围**：改动最小且聚焦，无顺手修改、调试残留、死代码。
- **健壮性**：处理边界和失败路径，错误信息有用；所有长度和限制与 PRD 一致。
- **假实现**：测试里的任何模拟服务必须执行与真实服务相同的规则（路由、头、字段限制、错误形状）。
- **测试**：不在写完代码后补单元测试；以 E2E 为唯一验证机制；如果必须孤立测试某个系统，先写出它所有可能的失败方式，再写代码。
