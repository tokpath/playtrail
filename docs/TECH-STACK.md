# PlayTrail 一期技术栈

> 日期：2026-11-08。对应 [PRD v1.1](PRD-v1.1.md)。
> 标 **已确定** 的四项由需求方选定；其余为配套建议，开工时的技术验证（spike）阶段可以调整，但调整后必须仍满足 PRD 的对应条款。

## 1. 已确定

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 后端 | **Go** | 负责全部 `/api/*`（公开接口和管理接口）、数据库访问、认证、发布门禁、导入、图片处理、统计事件、定时任务和 CrazyGames 爬虫（PRD 第 22 节） |
| 前端 | **Next.js**（App Router，TypeScript） | 只负责页面：公开页面服务端渲染满足 SEO（PRD 第 12 节），中间件处理 `Accept-Language` 跳转（第 4.2 节），另含管理后台界面。不直接连数据库 |
| 数据库 | **PostgreSQL** | 事务和原子写入满足导入要求（第 09 节），`eventId` 唯一约束去重（第 11 节），备份工具成熟 |
| 部署 | **Docker + VPS**，前面接 Cloudflare CDN | 成本低、可迁移，不锁定云厂商（第 10、15 节） |

开工时锁定 Go（≥ 1.25，需要标准库的 `http.CrossOriginProtection`）、Node.js LTS、Next.js、PostgreSQL 的当时稳定版本，写进 `go.mod`、lockfile 和 Dockerfile，不用 `latest`。

## 2. 职责划分

```
浏览器 ──▶ Cloudflare ──▶ Caddy（同一域名）
                           ├─ /api/*     ──▶ Go api
                           ├─ /media/*   ──▶ 静态素材卷（Caddy 直接读）
                           └─ 其他路径   ──▶ Next.js web
Next.js 服务端渲染 ──内网 HTTP──▶ Go api（http://api:8080）
```

- **Go 是唯一的业务和数据入口**。所有校验、门禁、权限都在 Go 里执行（第 10 节）；Next.js 只做展示和即时提示。
- **同域部署**：页面和 API 在同一个域名下，管理员会话 cookie 由 Go 签发，浏览器调用 `/api/admin/*` 时自动带上，不需要 CORS。
- **公开页面**：Next.js 服务端组件经内网调用 Go 的公开接口渲染 HTML。
- **管理后台**：`/admin/*` 页面由 Next.js 提供，界面在浏览器端渲染，数据全部通过 `/api/admin/*` 获取；未登录时 Go 返回 401，前端跳转到登录页。后台权限只由 Go 判断，不靠前端隐藏（第 07 节、E10）。
- **接口契约**：`api/openapi.yaml` 是 Go 和 Next.js 之间唯一的契约。Go 端用 oapi-codegen 生成请求 / 响应类型和服务端接口，前端用 openapi-typescript 生成 TS 类型，两边类型不手写、不漂移。

## 3. 后端（Go）

| 领域 | 建议 | 对应 PRD 要求 / 备注 |
| --- | --- | --- |
| HTTP 路由 | chi（兼容 `net/http`），按公开 / 管理分组挂中间件 | 管理组统一挂认证、CSRF、`Cache-Control: no-store` |
| 数据库驱动 | pgx v5 + pgxpool | |
| 查询 | sqlc：手写 SQL，生成类型安全的 Go 代码 | SQL 参数化（第 12.2 条）；搜索用 `ILIKE` 并转义 `%` `_`（第 10 节字面子串匹配） |
| 迁移 | goose，迁移文件嵌入二进制，提供 `playtrail migrate` 子命令 | 迁移脚本随代码交付 |
| 校验 | 手写校验函数，规则集中在 `internal/validate`：长度按 Unicode 码点、枚举、外链白名单（标准库 `net/url` 解析）、时间不晚于服务端当前时间 | 第 08 节的规则较细且有业务含义，手写比通用校验标签更直接、更好测 |
| 管理员认证 | alexedwards/scs 会话，存 PostgreSQL（pgxstore）；密码 argon2id（`golang.org/x/crypto/argon2`） | 第 12.1 条：HttpOnly / Secure / SameSite=Lax cookie、30 分钟无操作失效、登录后更换会话 ID、改密后删除该管理员全部会话 |
| CSRF | 标准库 `http.CrossOriginProtection`（基于 `Sec-Fetch-Site` / `Origin`）+ SameSite cookie | 所有写操作都不用 GET（第 10 节） |
| 登录限速 | 按账号 + 来源计数，存 PostgreSQL；超限返回 429 `RATE_LIMITED` | 计数只用于限速并短期过期，不进产品事件库 |
| 图片 | libvips（govips，cgo）：检验实际文件内容、去除元数据、重新编码为 WebP，生成 320w / 640w / 1280w；写入 `/data/media`，文件名带内容哈希 | 第 12.2 条、第 20 节；Go 标准库没有 WebP 编码器。spike 时如果不想引入 cgo，可评估纯 Go 的 gen2brain/webp |
| 统计事件 | `POST /api/events` 写原始事件表，`INSERT … ON CONFLICT (event_id) DO NOTHING`；只接收白名单字段；返回 202 | 第 11 节：不存 IP / UA，`receivedAt` 用服务端时间 |
| 定时任务 | 同一个二进制的 `playtrail worker` 子命令，单独跑一个容器：事件日聚合、清理过期原始事件（30 天）和聚合（90 天）、过期快照检查、爬虫调度 | 不依赖外部调度服务；用 PostgreSQL advisory lock 保证同一任务不会并发执行 |
| 爬虫 HTTP | **gocolly/colly v2**（需求方 2026-11-08 决定）：同步采集器，`LimitRule` 并发 1、间隔取自 `crawler_settings` 加 1 秒随机抖动；`AllowedDomains` 只含目标主机；`SetRedirectHandler` 只允许同主机重定向；`MaxBodySize` 32 MB（默认 10 MB 不够装 sitemap）；不用 Colly 的缓存和重试；固定 UA | PRD 第 22.4 节。`Retry-After`、退避、`ETag`、熔断、配额由本站代码包在 Colly 外面实现；Colly 只在 `internal/crawler/client.go` 中使用。**不用无头浏览器**，数据就在服务端渲染的 HTML 里 |
| robots.txt（补充） | Colly 的 `IgnoreRobotsTxt` 设为 true，由本站用 temoto/robotstxt 自行检查 | Colly 内置检查会在配额和运行记录之外自己去取 robots.txt |
| robots.txt | temoto/robotstxt 解析，每次运行前重新读取 | |
| sitemap 解析 | `encoding/xml` 的 `Decoder` 流式读取（英文 sitemap 约 15 MB），只取 `/game/` 条目的 `loc` 和 `xhtml:link` | 不把整个文件读进内存 |
| 游戏页解析 | `golang.org/x/net/html` 定位 `<script id="__NEXT_DATA__">`，`encoding/json` 解码到只含白名单字段的结构体；解析失败退回 JSON-LD `ItemPage`；带解析器版本号 | PRD 第 22.6 节：只解析白名单字段 |
| 爬虫状态 | 来源目录、变更、运行记录、配额都存 PostgreSQL；熔断计数也在库里，容器重启不丢 | PRD 第 22.10、22.11 节 |
| 缓存失效 | 发布 / 下架 / 停用快照后，Go 调用 Next.js 的内网失效接口（共享密钥，只在内网可达）按 tag 失效，并按 URL 调用 Cloudflare purge API | 第 07 节：60 秒内一致 |
| 时间 | 业务代码通过注入的 `Clock` 接口取时间；测试构建（build tag `e2e`）提供设置时间的内部接口，生产构建不包含 | 第 13 节要求固定快照时间、E14 需要推进到 48 小时后 |
| 错误格式 | 统一输出 `code`、`message`、`fieldErrors`、`requestId`；错误码取自 PRD 附录 A；panic 统一恢复为 500 且不泄露堆栈 | 第 10 节 |
| 日志 | 标准库 `log/slog` 输出 JSON，每条带 `requestId`；不记录会话、密码、IP 明文 | 第 11、12 节 |
| 代码质量 | `gofmt`、`go vet`、golangci-lint，CI 必须通过 | |

## 4. 前端（Next.js）

| 领域 | 建议 | 对应 PRD 要求 / 备注 |
| --- | --- | --- |
| 语言 / 包管理 | TypeScript strict，pnpm | 交付清单要求依赖锁定文件 |
| 语言跳转 | **自己写在 `middleware.ts` 里**，严格按第 4.2 节：只处理不带前缀的公开路径，302，`Vary: Accept-Language`，`Cache-Control: private, no-store`，不写 cookie | 现成 i18n 库的跳转默认行为（例如写语言 cookie、改写带前缀的地址）不符合 PRD，所以不用库的跳转 |
| 文案与格式化 | next-intl 只用来加载语言资源文件和做 `Intl` 日期 / 数字格式化 | 第 12.13 条：代码里不写死文案 |
| SEO | 服务端生成 title、description、canonical、hreflang、Open Graph；sitemap 和 robots 由 Next.js 路由输出，数据来自 Go 接口 | 第 12、20 节 |
| 样式 | CSS Modules 或 Tailwind（spike 时定），系统字体栈，不加载 Web 字体 | 第 12.9 条 |
| 统计上报 | 浏览器端用 `navigator.sendBeacon` / `fetch(keepalive)` 发到 `/api/events`，不 `await`、不阻止默认导航；DNT / GPC 开启时不发 | 第 11 节、E06 / E07 |
| 代码质量 | ESLint + Prettier + `tsc --noEmit`，CI 必须通过 | |

## 5. 测试

| 项 | 建议 | 备注 |
| --- | --- | --- |
| E2E | Playwright（TypeScript），用 docker compose 起完整栈（Caddy + web + api + 独立 PostgreSQL），固定种子数据和可控时钟 | 第 13 节 E01–E23；输出 HTML 报告、trace 和截图，作为可重复的交付证据 |
| 外部依赖模拟 | 统计接口离线 / 超时 / 429 用 Playwright 路由拦截模拟；出站链接拦截导航后校验 URL 和 `rel` | E06、E07 |
| 模拟 CrazyGames | 一个小的 Go 服务（`e2e/fake-crazygames`），用真实页面保存的 HTML、sitemap、robots 样本应答，可以按场景返回 404 / 429 / 503 / 人机验证页，并记录收到的每个请求（路径、时间、UA）供断言；E2E 时爬虫的目标主机通过测试构建指向它 | PRD E24–E27；生产构建里主机固定为 `www.crazygames.com`，不可配置 |
| 性能 | Lighthouse CI，按第 12.8 条的设备和网络参数跑 3 次 | 保留 3 次原始结果 |
| CI | GitHub Actions：两端 lint 和类型检查、构建 Docker 镜像、跑 E2E | 仓库托管平台待确认，换平台时等价迁移 |

## 6. 仓库结构

```
playtrail/
├─ api/openapi.yaml        接口契约（Go 和前端都从这里生成类型）
├─ backend/                Go module
│  ├─ cmd/playtrail/       子命令：serve / worker / migrate
│  ├─ internal/            handler、service、validate、auth、media、events、crawler …
│  └─ db/                  migrations/（goose）、queries/（sqlc）
├─ web/                    Next.js
├─ e2e/                    Playwright 用例、种子数据、fake-crazygames（模拟服务和页面样本）
├─ deploy/                 docker-compose.yml、Caddyfile、备份脚本
└─ docs/
```

## 7. 部署拓扑

```
访客 ──HTTPS──▶ Cloudflare（CDN / DNS / 基础防护）
                    │
                    ▼
              VPS（docker compose）
              ├─ caddy     反向代理和源站 HTTPS，按路径分流到 api / web，直接提供 /media
              ├─ web       Next.js standalone 输出（Node.js）
              ├─ api       Go 二进制（playtrail serve）
              ├─ worker    Go 二进制（playtrail worker）：定时任务 + 爬虫
              └─ postgres  数据卷持久化
              挂载卷：/data/media（素材）、/data/pg（数据库）
```

- 配置全部走环境变量，提供 `.env.example`（不含真实密钥）；开发、测试、生产隔离（第 12.12 条）。管理员初始账号通过 `playtrail admin create` 之类的子命令交互创建，不写进配置文件。
- 只有 Caddy 对外暴露端口；api、web、postgres 只在 compose 内网可达。
- 按 `Accept-Language` 跳转的 302 响应设 `Cache-Control: private, no-store`，Cloudflare 不缓存，避免不同语言的访客互相串缓存（第 4.2 节）。
- 备份：每天 `pg_dump` 加素材卷同步到异地对象存储，保留 14 天；导入确认和批量发布前额外备份一次；在测试环境演练恢复，满足 RPO ≤ 24 小时、RTO ≤ 4 小时（第 21 节）。
- 监控：外部拨测服务（候选：UptimeRobot、Better Stack）每 5 分钟检测首页、一个详情页和 `/api/games`，失败时通知运营负责人。
- VPS 区域等目标市场确定后再选（第 15 节）；Cloudflare 在中国大陆的访问效果不保证，如果主要面向大陆用户需要另行评估。

## 8. 待定

| 项 | 何时定 |
| --- | --- |
| 图片库用 govips（cgo）还是纯 Go 方案 | 技术验证阶段 |
| 前端样式方案 | 技术验证阶段 |
| `/hot` 页面的数据结构和解析方式；采集 E2E 用的页面样本 | 技术验证阶段 |
| VPS 供应商和区域 | 目标市场确定后 |
| 异地备份存储、拨测服务 | 上线前 |
| 代码托管与 CI 平台 | 建仓库时 |
