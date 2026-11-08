//go:build !e2e

package api

import "github.com/go-chi/chi/v5"

// mountClockRoutes registers nothing in normal builds: the test clock
// endpoints exist only under the e2e build tag.
func (s *Server) mountClockRoutes(chi.Router) {}
