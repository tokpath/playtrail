package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/db"
	sqlc "playtrail/backend/internal/db/sqlc"
)

// runRebuildPublic regenerates the public_games read model of every published
// game (ARCHITECTURE §6.2/A13): run it after changing EXTERNAL_COVERS_ENABLED
// or repairing drift between the read model and the source tables.
func runRebuildPublic(ctx context.Context) error {
	cfg, err := loadConfig(false)
	if err != nil {
		return err
	}
	pool, err := dbOpen(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	clk := buildClock()
	cat := newCatalogForWorker(pool, clk, cfg)

	ids, err := cat.Q.ListPublishedGameIDs(ctx)
	if err != nil {
		return err
	}
	rebuilt, failed := 0, 0
	for _, id := range ids {
		err := db.InTx(ctx, pool, func(q *sqlc.Queries) error {
			return cat.RebuildPublicGameTx(ctx, q, id)
		})
		if err != nil {
			if errors.Is(err, catalog.ErrPublicRebuildSkip) {
				continue
			}
			failed++
			fmt.Fprintf(os.Stderr, "game %s: %v\n", id, err)
			continue
		}
		rebuilt++
	}
	fmt.Fprintf(os.Stderr, "rebuilt %d games, %d failed\n", rebuilt, failed)
	if failed == 0 && rebuilt > 0 {
		// Read model refreshed: invalidate the web cache tags.
		cacheInvalidator(cfg).NotifySync("games", "hot", "dict")
	}
	if failed > 0 {
		return fmt.Errorf("%d games failed to rebuild", failed)
	}
	return nil
}
