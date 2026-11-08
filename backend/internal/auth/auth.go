// Package auth implements the admin session layer (ARCHITECTURE §5): scs
// sessions in PostgreSQL, argon2id password hashing, login rate limiting, and
// CSRF via http.CrossOriginProtection.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/alexedwards/scs/pgxstore"
	"github.com/alexedwards/scs/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"

	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
)

const (
	maxLoginFailures   = 10 // per email+IP prefix
	maxAccountFailures = 30 // per email, IP-independent
	loginWindow        = 15 * time.Minute
)

const (
	argonMemory  = 64 * 1024 // KiB
	argonTime    = 3
	argonThreads = 2
	argonKeyLen  = 32
	argonSaltLen = 16
)

// Manager bundles the session manager with admin lookups.
type Manager struct {
	Sessions *scs.SessionManager
	pool     *pgxpool.Pool
}

func NewManager(pool *pgxpool.Pool, idleTimeout time.Duration, secureCookie bool) *Manager {
	sm := scs.New()
	sm.Store = pgxstore.New(pool)
	sm.Cookie.Name = "pt_session"
	sm.Cookie.HttpOnly = true
	sm.Cookie.SameSite = http.SameSiteLaxMode
	sm.Cookie.Secure = secureCookie
	sm.IdleTimeout = idleTimeout
	return &Manager{Sessions: sm, pool: pool}
}

// HashPassword derives an argon2id PHC string from a password.
func HashPassword(password string) string {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key))
}

// VerifyPassword checks a password against an argon2id PHC hash.
func VerifyPassword(password, phc string) (bool, error) {
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, fmt.Errorf("unexpected password hash format")
	}
	var mem, iters uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &iters, &threads); err != nil {
		return false, fmt.Errorf("parse password hash params: %w", err)
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("decode salt: %w", err)
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, fmt.Errorf("decode key: %w", err)
	}
	got := argon2.IDKey([]byte(password), salt, iters, mem, threads, uint32(len(want)))
	return secureEqual(got, want), nil
}

func secureEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := range a {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}

// LoginAccountKey derives the per-account throttle key sha256(email|account);
// it caps total failures per email no matter how the attacker rotates IPs.
func LoginAccountKey(email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(email) + "|account"))
	return hex.EncodeToString(sum[:])
}

// LoginAttemptKey derives the rate-limit key sha256(email|IP prefix); the IP
// itself is never stored.
func LoginAttemptKey(email, ip string) string {
	prefix := ip
	if parsed := net.ParseIP(ip); parsed != nil {
		if v4 := parsed.To4(); v4 != nil {
			prefix = v4.Mask(net.CIDRMask(24, 32)).String()
		} else {
			prefix = parsed.Mask(net.CIDRMask(64, 128)).String()
		}
	}
	sum := sha256.Sum256([]byte(strings.ToLower(email) + "|" + prefix))
	return hex.EncodeToString(sum[:])
}

// CanLogin reports whether both the email+IP key and the per-account key are
// below their failure limits.
func CanLogin(ctx context.Context, q *sqlc.Queries, ipKey, accountKey string) (bool, error) {
	for key, maxFailures := range map[string]int{ipKey: maxLoginFailures, accountKey: maxAccountFailures} {
		row, err := q.GetLoginAttempt(ctx, key)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			return false, err
		}
		if time.Since(row.WindowStart) < loginWindow && int(row.Count) >= maxFailures {
			return false, nil
		}
	}
	return true, nil
}

// RecordLoginFailure increments the failure counters for both keys,
// restarting the 15-minute window when it has expired.
func RecordLoginFailure(ctx context.Context, q *sqlc.Queries, ipKey, accountKey string, now time.Time) error {
	for _, key := range []string{ipKey, accountKey} {
		if err := q.UpsertLoginAttempt(ctx, sqlc.UpsertLoginAttemptParams{
			Key:    key,
			Now:    now,
			Cutoff: now.Add(-loginWindow),
		}); err != nil {
			return err
		}
	}
	return nil
}

// ClearLoginFailures resets the counter after a successful login.
func ClearLoginFailures(ctx context.Context, q *sqlc.Queries, key string) error {
	return q.DeleteLoginAttempt(ctx, key)
}

// PutAdmin stores the admin id and the password_changed_at value in the session.
func (m *Manager) PutAdmin(ctx context.Context, id uuid.UUID, passwordChangedAt time.Time) {
	m.Sessions.Put(ctx, "admin_id", id.String())
	m.Sessions.Put(ctx, "password_changed_at", passwordChangedAt.Unix())
}

// CurrentAdmin returns the logged-in admin, or nil when no valid session
// exists. Sessions issued before the latest password change are destroyed.
func (m *Manager) CurrentAdmin(ctx context.Context, r *http.Request) (*sqlc.GetAdminRow, error) {
	idStr := m.Sessions.GetString(r.Context(), "admin_id")
	if idStr == "" {
		return nil, nil
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return nil, nil
	}
	admin, err := sqlc.New(m.pool).GetAdmin(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	loginAt, ok := m.Sessions.Get(r.Context(), "password_changed_at").(int64)
	if !ok || admin.PasswordChangedAt.Unix() != loginAt {
		_ = m.Sessions.Destroy(r.Context())
		return nil, nil
	}
	return &admin, nil
}

// CSRF returns middleware rejecting cross-origin writes with the unified 403
// body. Trusted origins are PUBLIC_BASE_URL (ARCHITECTURE §5).
func CSRF(trustedOrigin string) func(http.Handler) http.Handler {
	prot := http.NewCrossOriginProtection()
	if trustedOrigin != "" {
		if err := prot.AddTrustedOrigin(trustedOrigin); err != nil {
			slog.Error("invalid CSRF trusted origin", "origin", trustedOrigin, "error", err)
		}
	}
	prot.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.Forbidden("cross-origin request rejected"))
	}))
	return prot.Handler
}
