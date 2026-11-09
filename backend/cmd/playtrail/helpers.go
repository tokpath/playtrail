package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

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

// withJobLock owns a dedicated session until the job and lock cleanup finish.
// Contention returns false, nil; database/cleanup failures return an error.
func withJobLock(ctx context.Context, pool *pgxpool.Pool, name string, fn func()) (ran bool, err error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return false, err
	}
	// Unless unlocking is confirmed, discard this session rather than putting
	// a possibly locked connection back in the pool (including on cancellation).
	clean := false
	defer func() {
		if clean {
			conn.Release()
		} else {
			closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = conn.Hijack().Close(closeCtx)
		}
	}()
	var acquired bool
	if err = conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtext($1))", name).Scan(&acquired); err != nil {
		return false, err
	}
	if !acquired {
		clean = true
		return false, nil
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var unlocked bool
		unlockErr := conn.QueryRow(cleanupCtx, "SELECT pg_advisory_unlock(hashtext($1))", name).Scan(&unlocked)
		clean = unlockErr == nil && unlocked
		if !clean {
			if unlockErr == nil {
				unlockErr = fmt.Errorf("job lock %q was not held", name)
			}
			err = errors.Join(err, unlockErr)
		}
	}()
	fn()
	return true, nil
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
