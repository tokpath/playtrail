package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/crawler"
	"playtrail/backend/internal/hot"
	"playtrail/backend/internal/media"
	"playtrail/backend/internal/revalidate"
)

// runCrawl executes one crawler task manually (PRD 22.10): the same RunTask
// path the worker uses, so locks, quota, breaker, and SyncRun bookkeeping all
// apply. Example: playtrail crawl --task sitemap
func runCrawl(ctx context.Context) error {
	fs := flag.NewFlagSet("crawl", flag.ContinueOnError)
	task := fs.String("task", "", "crawler task: sitemap|tracked|backfill|hot")
	if err := fs.Parse(os.Args[2:]); err != nil {
		return err
	}
	if !crawler.ValidTask(*task) {
		return fmt.Errorf("crawl: --task must be one of sitemap, tracked, backfill, hot")
	}

	cfg, err := loadConfig(true)
	if err != nil {
		return err
	}
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))

	pool, err := dbOpen(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	clk := buildClock()
	notify := revalidate.New(cfg.WebInternalURL, cfg.InternalSecret).Notify
	mediaSvc := &media.Service{Dir: cfg.MediaDir, BaseURL: cfg.PublicBaseURL}
	cat := catalog.NewService(pool, clk, mediaSvc, cfg.PublicBaseURL, cfg.SupportedLocales, cfg.DefaultLocale, cfg.LocaleMinGames, cfg.ExternalCoversEnabled, notify)

	svc := &crawler.Service{
		Pool: pool, Q: cat.Q, Clock: clk, Cfg: cfg,
		Hot: &hot.Service{Catalog: cat}, Catalog: catalogBridge{c: cat, pool: pool},
		Notify: notify, Log: log,
	}
	run, err := svc.RunTask(ctx, *task)
	if err != nil {
		return err
	}
	fmt.Printf("task=%s run=%s outcome=%s requests=%d abort_reason=%s\n",
		run.Task, run.ID, run.Outcome, run.Requests, run.AbortReason)
	return nil
}
