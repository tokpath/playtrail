//go:build integration

package catalog

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	sqlc "playtrail/backend/internal/db/sqlc"
)

func TestDictionaryCacheIntegration(t *testing.T) {
	dsn := os.Getenv("INTEGRATION_DSN")
	if dsn == "" {
		t.Fatal("INTEGRATION_DSN must point to the isolated E2E database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	s := &Service{Q: sqlc.New(pool)}
	cats, err := s.Categories(ctx)
	if err != nil {
		t.Fatal(err)
	}
	tags, err := s.Tags(ctx)
	if err != nil {
		t.Fatal(err)
	}
	catExpiry, tagExpiry := s.catExpiry, s.tagExpiry
	// Failed DB access makes an unexpected query observable, without faking SQL.
	cancelled, stop := context.WithCancel(ctx)
	stop()
	for i := 0; i < 3; i++ {
		gotCats, err := s.Categories(cancelled)
		if err != nil || len(gotCats) != len(cats) {
			t.Fatalf("category cache miss: %v", err)
		}
		gotTags, err := s.Tags(cancelled)
		if err != nil || len(gotTags) != len(tags) {
			t.Fatalf("tag cache miss: %v", err)
		}
	}
	if s.catExpiry != catExpiry || s.tagExpiry != tagExpiry {
		t.Fatal("cache hit changed expiry")
	}
	// An expired category load failing must not touch the tag cache or expiry.
	s.catExpiry = time.Now().Add(-time.Second)
	if _, err := s.Categories(cancelled); err == nil {
		t.Fatal("expired categories unexpectedly loaded")
	}
	if s.tagExpiry != tagExpiry {
		t.Fatal("failed category load changed tag expiry")
	}
	if _, err := s.Tags(cancelled); err != nil {
		t.Fatal("category expiry evicted tags")
	}
	if _, err := s.Categories(ctx); err != nil {
		t.Fatal(err)
	}
	s.tagExpiry = time.Now().Add(-time.Second)
	if _, err := s.Tags(cancelled); err == nil {
		t.Fatal("expired tags unexpectedly loaded")
	}
	if _, err := s.Categories(cancelled); err != nil {
		t.Fatal("tag expiry evicted categories")
	}
	// Empty-but-loaded dictionaries are valid cache entries too.
	s.dictCats, s.dictTags = nil, nil
	s.catExpiry, s.tagExpiry = time.Now().Add(time.Minute), time.Now().Add(time.Minute)
	if _, err := s.Categories(cancelled); err != nil {
		t.Fatal("empty category cache missed")
	}
	if _, err := s.Tags(cancelled); err != nil {
		t.Fatal("empty tag cache missed")
	}
}
