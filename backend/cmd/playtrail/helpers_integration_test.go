//go:build integration

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"playtrail/backend/internal/config"
)

// These checks use a real PostgreSQL pool, not a fake that drops session locks.
func TestJobLockIntegration(t *testing.T) {
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
	other, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Release()
	name := "behavior-integration-" + time.Now().Format("150405.000000000")
	checkReleased := func() {
		t.Helper()
		var acquired bool
		if err := other.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtext($1))", name).Scan(&acquired); err != nil {
			t.Fatal(err)
		}
		if !acquired {
			t.Fatal("lock leaked after job")
		}
		if _, err := other.Exec(ctx, "SELECT pg_advisory_unlock(hashtext($1))", name); err != nil {
			t.Fatal(err)
		}
	}
	for _, mode := range []string{"normal", "cancel", "panic"} {
		t.Run(mode, func(t *testing.T) {
			jobCtx, stop := context.WithCancel(ctx)
			defer stop()
			func() {
				defer func() {
					r := recover()
					if mode == "panic" && r != "expected" {
						t.Errorf("expected job panic, got %v", r)
					}
					if mode != "panic" && r != nil {
						panic(r)
					}
				}()
				ran, err := withJobLock(jobCtx, pool, name, func() {
					var acquired bool
					if err := other.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtext($1))", name).Scan(&acquired); err != nil {
						t.Fatal(err)
					}
					if acquired {
						_, _ = other.Exec(ctx, "SELECT pg_advisory_unlock(hashtext($1))", name)
						t.Fatal("another session acquired an active job's lock")
					}
					if mode == "cancel" {
						stop()
					}
					if mode == "panic" {
						panic("expected")
					}
				})
				if !ran || err != nil {
					t.Errorf("ran=%v err=%v", ran, err)
				}
			}()
			checkReleased()
		})
	}
	t.Run("contention", func(t *testing.T) {
		if _, err := other.Exec(ctx, "SELECT pg_advisory_lock(hashtext($1))", name); err != nil {
			t.Fatal(err)
		}
		defer other.Exec(ctx, "SELECT pg_advisory_unlock(hashtext($1))", name)
		ran, err := withJobLock(ctx, pool, name, func() { t.Error("contended job ran") })
		if ran || err != nil {
			t.Errorf("ran=%v err=%v", ran, err)
		}
	})
	t.Run("unlock-error", func(t *testing.T) {
		ran, err := withJobLock(ctx, pool, name, func() {
			var pid int32
			if err := other.QueryRow(ctx, `SELECT pid FROM pg_locks
				WHERE locktype = 'advisory' AND granted
				AND classid = ((hashtext($1)::bigint >> 32) & 4294967295)::oid
				AND objid = (hashtext($1)::bigint & 4294967295)::oid AND objsubid = 1`, name).Scan(&pid); err != nil {
				t.Fatal(err)
			}
			var terminated bool
			if err := other.QueryRow(ctx, "SELECT pg_terminate_backend($1)", pid).Scan(&terminated); err != nil || !terminated {
				t.Fatalf("terminate lock session: %v", err)
			}
		})
		if !ran || err == nil {
			t.Fatalf("unlock failure not reported: ran=%v err=%v", ran, err)
		}
		checkReleased()
		if ran, err := withJobLock(ctx, pool, name, func() {}); !ran || err != nil {
			t.Fatalf("pool did not recover: ran=%v err=%v", ran, err)
		}
	})
	t.Run("database-error", func(t *testing.T) {
		closed, err := pgxpool.New(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		closed.Close()
		if ran, err := withJobLock(ctx, closed, name, func() { t.Error("job ran on closed pool") }); ran || err == nil {
			t.Errorf("database failure reported as contention: ran=%v err=%v", ran, err)
		}
	})
}

// Exercise rebuild's actual notifier against a protocol-faithful local HTTP
// receiver and the isolated E2E database, including the optional-secret path.
func TestRebuildNotificationIntegration(t *testing.T) {
	dsn := os.Getenv("INTEGRATION_DSN")
	if dsn == "" {
		t.Fatal("INTEGRATION_DSN is required")
	}
	t.Setenv("DATABASE_URL", dsn)
	secret := strings.Repeat("x", 32)
	received := make(chan []string, 4)
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/_internal/revalidate" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Internal-Secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Header.Get("Content-Type") != "application/json" {
			http.Error(w, "invalid content type", http.StatusBadRequest)
			return
		}
		var body struct {
			Tags []string `json:"tags"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Tags == nil {
			http.Error(w, "invalid tags", http.StatusBadRequest)
			return
		}
		received <- body.Tags
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	t.Setenv("WEB_INTERNAL_URL", receiver.URL)
	t.Setenv("INTERNAL_SECRET", secret)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := runRebuildPublic(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case tags := <-received:
		if strings.Join(tags, ",") != "games,hot,dict" {
			t.Fatalf("unexpected tags: %v", tags)
		}
	default:
		t.Fatal("rebuild exited before delivering cache invalidation")
	}
	t.Setenv("INTERNAL_SECRET", "")
	if err := runRebuildPublic(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-received:
		t.Fatal("rebuild sent notification without credentials")
	default:
	}
}

// Exercise config loading used by seed/rebuild with a real database DSN.
func TestOptionalCLIConfigIntegration(t *testing.T) {
	dsn := os.Getenv("INTEGRATION_DSN")
	if dsn == "" {
		t.Fatal("INTEGRATION_DSN is required")
	}
	t.Setenv("DATABASE_URL", dsn)
	for _, tc := range []struct {
		name, secret      string
		required, wantErr bool
	}{
		{"optional-missing", "", false, false},
		{"optional-valid", strings.Repeat("x", 32), false, false},
		{"optional-short", "short", false, true},
		{"required-missing", "", true, true},
		{"required-short", "short", true, true},
		{"required-valid", strings.Repeat("x", 32), true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("INTERNAL_SECRET", tc.secret)
			cfg, err := config.Load(tc.required)
			if (err != nil) != tc.wantErr {
				t.Fatalf("config error=%v, wantErr=%v", err, tc.wantErr)
			}
			if err == nil && cfg.InternalSecret != tc.secret {
				t.Fatal("supplied secret not loaded")
			}
		})
	}
}
