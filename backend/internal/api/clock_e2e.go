//go:build e2e

package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"playtrail/backend/internal/clock"
	"playtrail/backend/internal/httpx"
)

// mountClockRoutes registers POST/DELETE /api/_test/clock so E2E tests can
// control the clock (ARCHITECTURE §9). Present only under the e2e tag.
func (s *Server) mountClockRoutes(r chi.Router) {
	settable, ok := s.Clock.(*clock.Settable)
	if !ok {
		return
	}
	r.Post("/_test/clock", func(w http.ResponseWriter, req *http.Request) {
		var in struct {
			Now string `json:"now"`
		}
		if err := httpx.DecodeJSON(w, req, &in, 4<<10, true); err != nil {
			httpx.WriteError(w, req, err)
			return
		}
		t, err := time.Parse(time.RFC3339, in.Now)
		if err != nil {
			httpx.WriteError(w, req, httpx.InvalidParam("now must be RFC 3339"))
			return
		}
		settable.Set(t)
		w.WriteHeader(http.StatusNoContent)
	})
	r.Delete("/_test/clock", func(w http.ResponseWriter, req *http.Request) {
		settable.Reset()
		w.WriteHeader(http.StatusNoContent)
	})
}
