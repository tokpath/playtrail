package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"

	"playtrail/backend/internal/api"
	"playtrail/backend/internal/auth"
	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/crawler"
	"playtrail/backend/internal/dict"
	"playtrail/backend/internal/events"
	"playtrail/backend/internal/hot"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/imports"
	"playtrail/backend/internal/media"
	"playtrail/backend/internal/revalidate"
)

// buildClock is real time in production builds; e2e builds return a settable
// clock (see clock_e2e.go).
func runServe(ctx context.Context) error {
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
	notify := revalidate.New(cfg.WebInternalURL, cfg.InternalSecret).Notify
	mediaSvc := &media.Service{Dir: cfg.MediaDir, BaseURL: cfg.PublicBaseURL}
	cat := catalog.NewService(pool, clk, mediaSvc, cfg.PublicBaseURL, cfg.SupportedLocales, cfg.DefaultLocale, cfg.LocaleMinGames, cfg.ExternalCoversEnabled, notify)

	queries := cat.Q
	srv := &api.Server{
		Cfg:     cfg,
		Clock:   clk,
		Catalog: cat,
		Dict:    &dict.Service{Catalog: cat},
		Hot:     &hot.Service{Catalog: cat},
		Events:  events.NewService(cat, queries, pool, clk),
		Imports: &imports.Service{Catalog: cat, Locales: cfg.SupportedLocales, Clock: clk},
		Crawler: &crawler.Service{Pool: pool, Q: queries, Clock: clk, Cfg: cfg,
			Hot: &hot.Service{Catalog: cat}, Catalog: catalogBridge{c: cat, pool: pool}, Notify: notify, Log: log},
		Auth:  auth.NewManager(pool, cfg.SessionIdleTimeout, cfg.SecureCookie()),
		CSRF:  auth.CSRF(cfg.PublicBaseURL),
		Media: mediaSvc,
		Log:   log,
	}
	apiRouter, mediaHandler := api.New(srv)

	root := chi.NewRouter()
	root.Mount("/api", apiRouter)
	root.Handle("/media/*", mediaHandler)

	handler := httpx.RequestIDMiddleware(httpx.LoggerMiddleware(log)(httpx.Recover(root)))

	server := &http.Server{
		Addr:              cfg.APIAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Info("api listening", "addr", cfg.APIAddr)
	errCh := make(chan error, 1)
	go func() { errCh <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	case err := <-errCh:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	}
}
