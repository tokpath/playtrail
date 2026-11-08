package api

import (
	"net/http"

	"github.com/jackc/pgx/v5"

	sqlc "playtrail/backend/internal/db/sqlc"

	"playtrail/backend/internal/auth"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/validate"
)

func (s *Server) adminLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	q := s.Catalog.Q
	ip := s.clientIP(r)
	ipKey := auth.LoginAttemptKey(in.Email, ip)
	accountKey := auth.LoginAccountKey(in.Email)
	allowed, err := auth.CanLogin(r.Context(), q, ipKey, accountKey)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !allowed {
		httpx.WriteError(w, r, httpx.RateLimited())
		return
	}
	admin, err := q.GetAdminByEmail(r.Context(), in.Email)
	if err != nil {
		if err == pgx.ErrNoRows {
			_ = auth.RecordLoginFailure(r.Context(), q, ipKey, accountKey, s.Catalog.Clock.Now())
			httpx.WriteError(w, r, httpx.Unauthenticated())
			return
		}
		httpx.WriteError(w, r, err)
		return
	}
	ok, err := auth.VerifyPassword(in.Password, admin.PasswordHash)
	if err != nil || !ok {
		_ = auth.RecordLoginFailure(r.Context(), q, ipKey, accountKey, s.Catalog.Clock.Now())
		httpx.WriteError(w, r, httpx.Unauthenticated())
		return
	}
	if err := auth.ClearLoginFailures(r.Context(), q, ipKey); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := auth.ClearLoginFailures(r.Context(), q, accountKey); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := s.Auth.Sessions.RenewToken(r.Context()); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	s.Auth.PutAdmin(r.Context(), admin.ID, admin.PasswordChangedAt)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminLogout(w http.ResponseWriter, r *http.Request) {
	_ = s.Auth.Sessions.Destroy(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminMe(w http.ResponseWriter, r *http.Request) {
	admin, err := s.Auth.CurrentAdmin(r.Context(), r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"id": admin.ID, "email": admin.Email})
}

// adminChangePassword verifies the current password, stores the new hash,
// and stamps password_changed_at, which invalidates every older session
// (ARCHITECTURE §5: sessions carry the value and are compared per request).
func (s *Server) adminChangePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin, err := s.Auth.CurrentAdmin(r.Context(), r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	fields := map[string]string{}
	if ok, err := auth.VerifyPassword(in.CurrentPassword, admin.PasswordHash); err != nil || !ok {
		fields["currentPassword"] = "incorrect"
	}
	if n := validate.Len(in.NewPassword); n < 12 || n > 200 {
		fields["newPassword"] = "length must be 12-200 code points"
	}
	if len(fields) > 0 {
		httpx.WriteError(w, r, httpx.Validation(fields))
		return
	}
	now := s.Catalog.Clock.Now()
	updated, err := s.Catalog.Q.UpdateAdminPassword(r.Context(), sqlc.UpdateAdminPasswordParams{
		ID:           admin.ID,
		PasswordHash: auth.HashPassword(in.NewPassword),
		ChangedAt:    now,
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	// Keep the current session alive; all others die on the next request.
	s.Auth.PutAdmin(r.Context(), updated.ID, updated.PasswordChangedAt)
	w.WriteHeader(http.StatusNoContent)
}
