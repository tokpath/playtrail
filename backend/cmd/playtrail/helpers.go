package main

import (
	"context"
	"fmt"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/config"
	"playtrail/backend/internal/db"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/revalidate"
)

func loadConfig(requireInternal bool) (*config.Config, error) {
	return config.Load(requireInternal)
}

func dbOpen(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// acquireJobLock takes a session-level advisory lock keyed by job name so
// concurrent workers never run the same job twice (TECH-STACK §3).
func acquireJobLock(ctx context.Context, pool *pgxpool.Pool, name string) bool {
	var ok bool
	if err := pool.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtext($1))", name).Scan(&ok); err != nil {
		return false
	}
	return ok
}

func releaseJobLock(ctx context.Context, pool *pgxpool.Pool, name string) {
	_, _ = pool.Exec(ctx, "SELECT pg_advisory_unlock(hashtext($1))", name)
}

// cacheInvalidator builds the web cache notifier. Without INTERNAL_SECRET the
// web would reject the call (403): warn once and skip instead of sending an
// unauthenticated request (B11).
func cacheInvalidator(cfg *config.Config) *revalidate.Notifier {
	if cfg.InternalSecret == "" {
		fmt.Fprintln(os.Stderr, "warning: INTERNAL_SECRET is not set; skipping web cache invalidation")
		return nil
	}
	return revalidate.New(cfg.WebInternalURL, cfg.InternalSecret)
}

// catalogBridge adapts catalog.Service to the crawler.Catalog interface: the
// crawler passes game IDs and the bridge supplies the transaction.
type catalogBridge struct {
	c    *catalog.Service
	pool *pgxpool.Pool
}

func (b catalogBridge) RebuildPublicGameTx(ctx context.Context, gameID uuid.UUID) error {
	return db.InTx(ctx, b.pool, func(q *sqlc.Queries) error {
		return b.c.RebuildPublicGameTx(ctx, q, gameID)
	})
}
