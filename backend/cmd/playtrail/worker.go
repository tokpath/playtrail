package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"time"

	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/clock"
	"playtrail/backend/internal/config"
	"playtrail/backend/internal/crawler"
	"playtrail/backend/internal/events"
	"playtrail/backend/internal/hot"
	"playtrail/backend/internal/media"
	"playtrail/backend/internal/revalidate"

	"github.com/jackc/pgx/v5/pgxpool"
)

// newCatalogForWorker builds the catalog service with no revalidation
// notifier: the worker's jobs never change public data.
func newCatalogForWorker(pool *pgxpool.Pool, clk clock.Clock, cfg *config.Config) *catalog.Service {
	mediaSvc := &media.Service{Dir: cfg.MediaDir, BaseURL: cfg.PublicBaseURL}
	return catalog.NewService(pool, clk, mediaSvc, cfg.PublicBaseURL, cfg.SupportedLocales, cfg.DefaultLocale, cfg.LocaleMinGames, cfg.ExternalCoversEnabled, nil)
}

// runWorker runs the periodic jobs (TECH-STACK §3): event aggregation every
// 10 minutes, retention cleanup daily, session cleanup hourly. Each job takes
// a PostgreSQL advisory lock so only one worker runs it at a time. Crawler
// tasks share a host-wide lock and run serially.
func runWorker(ctx context.Context) error {
	cfg, err := loadConfig(true)
	if err != nil {
		return err
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	pool, err := dbOpen(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	clk := buildClock()
	cat := newCatalogForWorker(pool, clk, cfg)
	notify := revalidate.New(cfg.WebInternalURL, cfg.InternalSecret).Notify
	ev := events.NewService(cat, cat.Q, pool, clk)

	const (
		aggregateInterval       = 10 * time.Minute
		retentionInterval       = 24 * time.Hour
		sessionInterval         = time.Hour
		crawlerSitemapInterval  = 24 * time.Hour
		crawlerTrackedInterval  = 24 * time.Hour
		crawlerBackfillInterval = 24 * time.Hour
		crawlerHotInterval      = 6 * time.Hour
		rawCleanupInterval      = 24 * time.Hour
	)
	lastAggregate, lastRetention, lastSessions := time.Time{}, time.Time{}, time.Time{}
	lastCrawl := map[string]time.Time{}
	var lastRawCleanup, lastCrawlHealth time.Time

	log.Info("worker started", "opsTimezone", cfg.OpsTimezone.String())
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	runIfDue := func(interval time.Duration, last time.Time, name string, fn func()) time.Time {
		if clk.Now().Sub(last) < interval {
			return last
		}
		if !acquireJobLock(ctx, pool, name) {
			return last
		}
		defer releaseJobLock(ctx, pool, name)
		fn()
		return clk.Now()
	}

	// Crawler tasks (PRD 22.3): the intervals live here; the per-run
	// discipline (locks, quota, breaker) lives in the crawler package.
	crawlerSvc := &crawler.Service{Pool: pool, Q: cat.Q, Clock: clk, Cfg: cfg,
		Hot: &hot.Service{Catalog: cat}, Catalog: catalogBridge{c: cat, pool: pool},
		Notify: notify, Log: log}
	runCrawlIfDue := func(task string, interval time.Duration) {
		now := clk.Now()
		if now.Sub(lastCrawl[task]) < interval {
			return
		}
		lastCrawl[task] = now
		if updated, err := crawlerSvc.RunTask(ctx, task); err != nil {
			if !errors.Is(err, crawler.ErrDisabledByEnv) && !errors.Is(err, crawler.ErrPaused) {
				log.Warn("crawler task failed", "task", task, "error", err)
			}
			return
		} else if updated != nil {
			log.Info("crawler task done", "task", task, "outcome", "ok")
		}
	}
	runCrawlRawCleanup := func() {
		if lastRawCleanup.IsZero() || clk.Now().Sub(lastRawCleanup) >= rawCleanupInterval {
			if !acquireJobLock(ctx, pool, "crawler_raw_cleanup") {
				return
			}
			defer releaseJobLock(ctx, pool, "crawler_raw_cleanup")
			now := clk.Now()
			n, err := cat.Q.ClearExpiredSourceRaw(ctx, &now)
			if err != nil {
				log.Error("crawler raw cleanup failed", "error", err)
				return
			}
			if n > 0 {
				log.Info("crawler raw cleanup", "cleared", n)
			}
			lastRawCleanup = clk.Now()
		}
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			lastAggregate = runIfDue(aggregateInterval, lastAggregate, "aggregate_events", func() {
				now := clk.Now().In(cfg.OpsTimezone)
				for _, day := range []time.Time{now, now.AddDate(0, 0, -1)} {
					if err := ev.AggregateDay(ctx, day, cfg.OpsTimezone); err != nil {
						log.Error("aggregate events failed", "day", day.Format("2006-01-02"), "error", err)
						return
					}
				}
				log.Info("aggregated events", "day", now.Format("2006-01-02"))
			})
			lastRetention = runIfDue(retentionInterval, lastRetention, "retention_cleanup", func() {
				raw, daily, err := ev.CleanupRetention(ctx, clk.Now())
				if err != nil {
					log.Error("retention cleanup failed", "error", err)
					return
				}
				log.Info("retention cleanup", "rawDeleted", raw, "dailyDeleted", daily)
			})
			lastSessions = runIfDue(sessionInterval, lastSessions, "session_cleanup", func() {
				n, err := ev.CleanupSessions(ctx)
				if err != nil {
					log.Error("session cleanup failed", "error", err)
					return
				}
				if n > 0 {
					log.Info("session cleanup", "deleted", n)
				}
			})
			runCrawlIfDue("sitemap", crawlerSitemapInterval)
			runCrawlIfDue("tracked", crawlerTrackedInterval)
			runCrawlIfDue("hot", crawlerHotInterval)
			runCrawlIfDue("backfill", crawlerBackfillInterval)
			runCrawlRawCleanup()
			if clk.Now().Sub(lastCrawlHealth) >= time.Hour {
				crawlerSvc.CheckHealth(ctx)
				lastCrawlHealth = clk.Now()
			}
		}
	}
}
