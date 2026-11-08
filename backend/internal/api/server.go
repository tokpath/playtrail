// Package api contains the HTTP handlers (ARCHITECTURE §1): handlers only
// decode/encode and call the domain packages.
package api

import (
	"log/slog"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"playtrail/backend/internal/auth"
	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/clock"
	"playtrail/backend/internal/config"
	"playtrail/backend/internal/crawler"
	"playtrail/backend/internal/dict"
	"playtrail/backend/internal/events"
	"playtrail/backend/internal/hot"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/imports"
	"playtrail/backend/internal/media"
)

// Server wires the domain services into handlers.
type Server struct {
	Cfg     *config.Config
	Clock   clock.Clock
	Catalog *catalog.Service
	Dict    *dict.Service
	Hot     *hot.Service
	Events  *events.Service
	Imports *imports.Service
	Auth    *auth.Manager
	CSRF    func(http.Handler) http.Handler
	Crawler *crawler.Service
	Media   *media.Service
	Log     *slog.Logger
}

// New builds the /api router and the /media file handler.
func New(s *Server) (apiHandler http.Handler, mediaHandler http.Handler) {
	r := chi.NewRouter()
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		httpx.WriteError(w, req, httpx.NotFound("not found"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		httpx.WriteError(w, req, httpx.InvalidParam("method not allowed"))
	})

	// Public reads: s-maxage=30 per §5.
	r.Group(func(g chi.Router) {
		g.Use(httpx.CacheControl(true))
		g.Get("/meta", s.getMeta)
		g.Get("/home", s.getHome)
		g.Get("/games", s.listGames)
		g.Get("/games/{slug}", s.getGame)
		g.Get("/categories", s.listCategories)
		g.Get("/categories/{slug}", s.getCategory)
		g.Get("/tags", s.listTags)
		g.Get("/hot", s.getHot)
		g.Get("/sitemap", s.getSitemap)
		g.Get("/unlisted-slugs", s.getUnlistedSlugs)
	})

	// Public writes: CSRF-protected (§5).
	r.Group(func(g chi.Router) {
		g.Use(s.CSRF)
		g.Post("/events", s.postEvent)
		s.mountClockRoutes(g)
	})

	// Admin: session + CSRF + no-store on everything (§5).
	r.Route("/admin", func(admin chi.Router) {
		admin.Use(s.Auth.Sessions.LoadAndSave, httpx.CacheControl(false), s.CSRF)
		admin.Post("/login", s.adminLogin)
		admin.Post("/logout", s.adminLogout)
		admin.Group(func(g chi.Router) {
			g.Use(s.requireAdmin)
			g.Get("/me", s.adminMe)
			g.Post("/password", s.adminChangePassword)
			g.Get("/dashboard", s.adminDashboard)
			g.Get("/games", s.adminListGames)
			g.Post("/games", s.adminCreateGame)
			g.Get("/games/{id}", s.adminGetGame)
			g.Patch("/games/{id}", s.adminPatchGame)
			g.Post("/games/{id}/locales/{locale}/review", s.adminReviewLocale)
			g.Post("/games/{id}/link-check", s.adminLinkCheck)
			g.Get("/games/{id}/gates", s.adminGates)
			g.Post("/games/{id}/publish", s.adminPublish)
			g.Post("/games/{id}/unlist", s.adminUnlist)
			g.Post("/games/{id}/outbound", s.adminOutbound)
			g.Get("/games/{id}/preview", s.adminPreview)
			g.Post("/media", s.adminUploadMedia)
			g.Get("/media/{id}", s.adminGetMedia)
			g.Patch("/media/{id}", s.adminPatchMedia)
			g.Get("/categories", s.adminListCategories)
			g.Patch("/categories/{slug}", s.adminPatchCategory)
			g.Get("/tags", s.adminListTags)
			g.Post("/tags", s.adminCreateTag)
			g.Patch("/tags/{slug}", s.adminPatchTag)
			g.Get("/hot-snapshots", s.adminListHotSnapshots)
			g.Post("/hot-snapshots", s.adminCreateHotSnapshot)
			g.Post("/hot-snapshots/{id}/review", s.adminReviewHotSnapshot)
			g.Post("/hot-snapshots/{id}/deactivate", s.adminDeactivateHotSnapshot)
			g.Post("/imports/preview", s.adminImportPreview)
			g.Post("/imports/commit", s.adminImportCommit)
			g.Get("/imports/{id}", s.adminGetImport)
			g.Get("/stats", s.adminStats)
			g.Get("/audit", s.adminAudit)

			// Crawler endpoints (ARCHITECTURE §6.3, PRD 22).
			g.Get("/source-games", s.adminListSourceGames)
			g.Get("/source-games/{id}", s.adminGetSourceGame)
			g.Post("/source-games/{id}/collect", s.adminCollectSourceGame)
			g.Get("/source-changes", s.adminListSourceChanges)
			g.Post("/source-changes/{id}/resolve", s.adminResolveSourceChange)
			g.Get("/tag-mappings", s.adminListTagMappings)
			g.Put("/tag-mappings/{sourceTagSlug}", s.adminPutTagMapping)
			g.Get("/crawler", s.adminGetCrawler)
			g.Patch("/crawler", s.adminPatchCrawler)
			g.Post("/crawler/run", s.adminRunCrawler)
		})
	})

	return r, mediaFileHandler(s.Media.Dir)
}

// requireAdmin rejects unauthenticated or stale sessions with 401.
func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		admin, err := s.Auth.CurrentAdmin(r.Context(), r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if admin == nil {
			httpx.WriteError(w, r, httpx.Unauthenticated())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP extracts the client IP for rate limiting only; it is never logged
// or stored (§5). When TRUSTED_PROXY_HEADER is configured, it is honored only
// for requests from loopback or private addresses (Caddy/compose network),
// and only when the header value is a single valid IP. Everything else falls
// back to RemoteAddr, so clients cannot spoof their way past the throttles.
func (s *Server) clientIP(r *http.Request) string {
	remote := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	hdr := s.Cfg.TrustedProxyHeader
	if hdr == "" {
		return remote
	}
	if ip := net.ParseIP(remote); ip == nil || (!ip.IsLoopback() && !ip.IsPrivate()) {
		return remote
	}
	value := r.Header.Get(hdr)
	if pip := net.ParseIP(strings.TrimSpace(value)); pip != nil {
		return pip.String()
	}
	return remote
}
