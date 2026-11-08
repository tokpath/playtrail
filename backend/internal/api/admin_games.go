package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/httpx"
)

// adminID returns the logged-in admin's UUID (requireAdmin has run).
func (s *Server) adminID(r *http.Request) uuid.UUID {
	admin, _ := s.Auth.CurrentAdmin(r.Context(), r)
	return admin.ID
}

func (s *Server) gameID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return uuid.Nil, httpx.InvalidParam("id must be a UUID")
	}
	return id, nil
}

func (s *Server) adminCreateGame(w http.ResponseWriter, r *http.Request) {
	var in catalog.CreateInput
	if err := decodeBody(w, r, &in, 64<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.CreateGame(r.Context(), in, admin.String(), &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, game)
}

func (s *Server) adminGetGame(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	game, err := s.Catalog.AdminGame(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, game)
}

func (s *Server) adminPatchGame(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in catalog.PatchInput
	if err := decodeBody(w, r, &in, 256<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.PatchGame(r.Context(), id, in, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, game)
}

func (s *Server) adminReviewLocale(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in catalog.ReviewInput
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.ReviewLocale(r.Context(), id, chi.URLParam(r, "locale"), in, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, game)
}

func (s *Server) adminLinkCheck(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in catalog.LinkCheckInput
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.LinkCheck(r.Context(), id, in, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, game)
}

func (s *Server) adminGates(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var locales []string
	if raw := r.URL.Query().Get("locales"); raw != "" {
		for _, l := range strings.Split(raw, ",") {
			if l = strings.TrimSpace(l); l != "" {
				locales = append(locales, l)
			}
		}
	}
	report, err := s.Catalog.GateReportFor(r.Context(), id, locales)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, report)
}

func (s *Server) adminPublish(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in catalog.PublishInput
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.Publish(r.Context(), id, in, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, game)
}

func (s *Server) adminUnlist(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in catalog.UnlistInput
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.Unlist(r.Context(), id, in, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, game)
}

func (s *Server) adminOutbound(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in catalog.OutboundInput
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.SetOutbound(r.Context(), id, in, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, game)
}

func (s *Server) adminPreview(w http.ResponseWriter, r *http.Request) {
	id, err := s.gameID(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	detail, err := s.Catalog.PreviewDetail(r.Context(), id, r.URL.Query().Get("locale"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, detail)
}

func (s *Server) adminListGames(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := intParam(q.Get("page"), 1)
	pageSize := intParam(q.Get("pageSize"), 24)
	list, err := s.Catalog.ListAdminGames(r.Context(), catalog.AdminListParams{
		Status:     q.Get("status"),
		LinkStatus: q.Get("linkStatus"),
		Review:     q.Get("review"),
		Locale:     q.Get("locale"),
		Q:          q.Get("q"),
		Page:       page,
		PageSize:   pageSize,
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, list)
}

func intParam(raw string, def int) int {
	if n, err := strconv.Atoi(raw); err == nil && n > 0 {
		return n
	}
	return def
}

// decodeBody decodes a JSON request body, ignoring unknown fields (PRD 10:
// the server filters fields it does not write).
func decodeBody(w http.ResponseWriter, r *http.Request, v any, maxBytes int64) error {
	return httpx.DecodeJSON(w, r, v, maxBytes, false)
}
