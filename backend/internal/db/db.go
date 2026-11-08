// Package db owns the pgx pool, the transaction helper, and goose migrations.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"

	migrations "playtrail/backend/db"
	sqlc "playtrail/backend/internal/db/sqlc"
)

// Open creates a pgx pool for the given connection string.
func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
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

// InTx runs fn inside a database transaction, rolling back on error —
// including when fn panics, so a recovered panic can never leak the
// connection or the row locks it holds.
func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(q *sqlc.Queries) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx) // no-op (ErrTxClosed) after a successful Commit
	}()
	q := sqlc.New(tx)
	if err := fn(q); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	return nil
}

// Migrate applies all pending goose migrations embedded in the binary.
func Migrate(ctx context.Context, databaseURL string) error {
	conn, err := openStdlib(databaseURL)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("goose dialect: %w", err)
	}
	if err := goose.UpContext(ctx, conn, "migrations"); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
