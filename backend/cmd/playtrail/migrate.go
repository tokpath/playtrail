package main

import (
	"context"

	"playtrail/backend/internal/db"
)

// runMigrate applies the embedded goose migrations (ADR A5).
func runMigrate(ctx context.Context) error {
	cfg, err := loadConfig(false)
	if err != nil {
		return err
	}
	return db.Migrate(ctx, cfg.DatabaseURL)
}
