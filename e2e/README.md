# PlayTrail E2E

Two layers, per the agreed stack:

- **Playwright suite** (`tests/e01-…spec.ts` … `e27-…spec.ts`, this directory):
  user-level flows against the built app and API, covering PRD §13 E01–E27.
- **Go fake server** (`fake-crazygames/`): stands in for `www.crazygames.com`
  and serves real page samples from `fake-crazygames/samples/` with
  scenario control (`POST /_control`) and a request log (`GET/DELETE /_log`).

## Running

```sh
make e2e
```

`make e2e` starts the isolated stack, runs the whole Playwright suite and
always stops the stack afterwards (also on test failure).

Prerequisites:

- Docker with the dev Postgres container (`playtrail-dev-db`, port 55432).
  The suite uses a separate database `playtrail_e2e` on the same
  instance; it is dropped and recreated on every `stack.sh start`.
- Go toolchain (api is built with `-tags e2e`, fake server is built).
- pnpm (web production build; the stack serves `web/.next-e2e-dist/standalone/server.js`
  with the static assets copied in, Playwright deps install).
- Playwright browsers: `cd e2e && pnpm exec playwright install chromium webkit`
  (once).

The stack listens on 127.0.0.1 only, on ports distinct from the dev stack:

| service         | port |
| --------------- | ---- |
| api (`-tags e2e`) | 8091 |
| web (production build) | 3100 |
| fake-crazygames | 8095 |
| postgres (dev container, db `playtrail_e2e`) | 55432 |

The api exposes the e2e-only clock endpoints (`POST/DELETE /api/_test/clock`),
and the e2e binary refuses to run the crawler against anything but a loopback
`CRAWLER_BASE_URL`.

## Stack control

```sh
bash e2e/scripts/stack.sh start   # reset db, migrate, admin, seed, serve
bash e2e/scripts/stack.sh stop
```

Seed data: `e2e/fixtures/e2e-pack.json` (seed-pack format, deterministic;
33 fixture games). States the seed cannot create — unlisted, suspect and
invalid link — are applied once by `global-setup.ts` through the real admin
API.

## Scenario → spec map

| PRD | spec file | scope |
| --- | --- | --- |
| E01 浏览与分类 | `tests/e01-browse-categories.spec.ts` | all 4 projects |
| E02 搜索与组合筛选 | `tests/e02-search-filter.spec.ts` | all 4 |
| E03 排序分页 | `tests/e03-sort-pagination.spec.ts` | all 4 |
| E04 搜索空态 | `tests/e04-empty-state.spec.ts` | all 4 |
| E05 详情与无图 | `tests/e05-detail-no-image.spec.ts` | all 4 |
| E06 正常出站 | `tests/e06-outbound-ok.spec.ts` | all 4 |
| E07 统计失败仍离站 | `tests/e07-outbound-events-fail.spec.ts` | all 4 |
| E08 已知失效/待核 | `tests/e08-link-status.spec.ts` | all 4 |
| E09 草稿与下架 | `tests/e09-draft-unlisted.spec.ts` | all 4 |
| E10 后台鉴权 | `tests/e10-admin-auth.spec.ts` | chromium-1440 |
| E11 草稿修订与发布 | `tests/e11-revision-publish.spec.ts` | chromium-1440 |
| E12 导入与幂等 | `tests/e12-import-idempotent.spec.ts` | chromium-1440 |
| E13 URL/文本安全 | `tests/e13-url-text-safety.spec.ts` | chromium-1440 |
| E14 热门时效 | `tests/e14-hot-stale.spec.ts` | chromium-1440 |
| E15 分类标签与名义 | `tests/e15-category-naming.spec.ts` | all 4 |
| E16 统计去重与隐私 | `tests/e16-stats-dedup-privacy.spec.ts` | chromium-1440 |
| E17 SEO 与 404 | `tests/e17-seo-404.spec.ts` | chromium-1440 |
| E18 体验（视口/键盘） | `tests/e18-a11y-viewport.spec.ts` | chromium-1440 |
| E19 语言跳转与切换 | `tests/e19-locale-redirect.spec.ts` | chromium-1440 |
| E20 按语言发布 | `tests/e20-locale-publish.spec.ts` | chromium-1440 |
| E21 搜索不跨语言 | `tests/e21-search-locale.spec.ts` | all 4 |
| E22 相关游戏 | `tests/e22-related-games.spec.ts` | all 4 |
| E23 分享元数据 | `tests/e23-share-metadata.spec.ts` | chromium-1440 |
| E24 爬虫规则与熔断 | `tests/e24-crawler-rules.spec.ts` | chromium-1440 |
| E25 来源目录与收录 | `tests/e25-source-catalog.spec.ts` | chromium-1440 |
| E26 自动维护与变更 | `tests/e26-tracked-maintenance.spec.ts` | chromium-1440 |
| E27 热门快照自动生成 | `tests/e27-hot-auto.spec.ts` | chromium-1440 |

Performance (PRD 12.8) and backup/restore are not Playwright-automated; they
are recorded as manual evidence in the acceptance report (restore was already
verified by the deploy run).

## Artifacts

- HTML report: `report/html/index.html` (`pnpm exec playwright show-report`)
- Machine-readable results: `report/results.json`
- Per-test screenshots (success + failure) and failure traces: `test-results/`
  and the HTML report.

## Crawler evidence runner

`fake-crazygames/verify.py` is the crawler's scripted evidence runner for the
PRD 22 scenarios (quota/pause/robots/limits etc.). It is a scripted driver,
not a Playwright test, because the crawler is a backend worker without a UI
surface; the Playwright specs e24–e27 drive the same binary and fake server
and are the acceptance entry point. See `fake-crazygames/` for the sample
pages and control API.
