package api

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/events"
	"playtrail/backend/internal/httpx"
)

func (s *Server) getMeta(w http.ResponseWriter, r *http.Request) {
	meta, err := s.Catalog.MetaData(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, meta)
}

func (s *Server) getHome(w http.ResponseWriter, r *http.Request) {
	locale := r.URL.Query().Get("locale")
	featured, err := s.Catalog.FeaturedGames(r.Context(), locale)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	snapshot, err := s.Hot.PublicSnapshot(r.Context(), locale)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if snapshot != nil && snapshot.Stale {
		snapshot = nil // the home endpoint hides stale snapshots (§4.7)
	}
	categories, err := s.Catalog.HomeCategories(r.Context(), locale)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := s.Catalog.TotalGames(r.Context(), locale)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	updatedAt, err := s.Catalog.HomeUpdatedAt(r.Context(), locale)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var updatedAtStr *string
	if updatedAt != nil {
		t := updatedAt.Format(time.RFC3339)
		updatedAtStr = &t
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"featured":   featured,
		"hot":        snapshot,
		"categories": categories,
		"totalGames": total,
		"updatedAt":  updatedAtStr,
	})
}

func (s *Server) listGames(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := intParam(q.Get("page"), 1)
	pageSize := intParam(q.Get("pageSize"), 24)
	list, err := s.Catalog.ListGames(r.Context(), catalog.ListParams{
		Locale:   q.Get("locale"),
		Q:        q.Get("q"),
		Category: q.Get("category"),
		Tag:      q.Get("tag"),
		Sort:     q.Get("sort"),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, list)
}

func (s *Server) getGame(w http.ResponseWriter, r *http.Request) {
	detail, err := s.Catalog.Detail(r.Context(), chi.URLParam(r, "slug"), r.URL.Query().Get("locale"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, detail)
}

func (s *Server) listCategories(w http.ResponseWriter, r *http.Request) {
	items, err := s.Catalog.CategoryCounts(r.Context(), r.URL.Query().Get("locale"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) getCategory(w http.ResponseWriter, r *http.Request) {
	category, err := s.Catalog.CategoryCountOf(r.Context(), r.URL.Query().Get("locale"), chi.URLParam(r, "slug"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"category": category})
}

func (s *Server) listTags(w http.ResponseWriter, r *http.Request) {
	items, err := s.Catalog.TagCounts(r.Context(), r.URL.Query().Get("locale"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) getHot(w http.ResponseWriter, r *http.Request) {
	snapshot, err := s.Hot.PublicSnapshot(r.Context(), r.URL.Query().Get("locale"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"snapshot": snapshot})
}

func (s *Server) getSitemap(w http.ResponseWriter, r *http.Request) {
	data, err := s.Catalog.Sitemap(r.Context(), r.URL.Query().Get("locale"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (s *Server) getUnlistedSlugs(w http.ResponseWriter, r *http.Request) {
	slugs, err := s.Catalog.UnlistedSlugs(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if slugs == nil {
		slugs = []string{}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"slugs": slugs})
}

func (s *Server) postEvent(w http.ResponseWriter, r *http.Request) {
	var ev events.Event
	if err := httpx.DecodeJSON(w, r, &ev, 64<<10, true); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !s.Events.Allow(s.clientIP(r)) {
		httpx.WriteError(w, r, httpx.RateLimited())
		return
	}
	if err := s.Events.Ingest(r.Context(), ev, ev.Locale); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// ---- /media file serving (§5) ----

func mediaFileHandler(dir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rel := chi.URLParam(r, "*")
		clean := path.Clean("/" + rel) // anchors the path and removes traversal
		full := filepath.Join(dir, clean)
		if !strings.HasPrefix(full, filepath.Clean(dir)+string(os.PathSeparator)) {
			httpx.WriteError(w, r, httpx.NotFound("not found"))
			return
		}
		w.Header().Set("Content-Type", "image/webp")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeFile(w, r, full)
	}
}
