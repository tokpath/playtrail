package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"playtrail/backend/internal/dict"
	"playtrail/backend/internal/hot"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/imports"
	"playtrail/backend/internal/validate"
)

func validateEnumField(field, s string, allowed ...string) error {
	return validate.EnumField(field, s, allowed...)
}

// ---- categories ----

func (s *Server) adminListCategories(w http.ResponseWriter, r *http.Request) {
	items, err := s.Dict.Categories(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) adminPatchCategory(w http.ResponseWriter, r *http.Request) {
	var in dict.CategoryPatchInput
	if err := decodeBody(w, r, &in, 32<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	items, err := s.Dict.PatchCategory(r.Context(), chi.URLParam(r, "slug"), in, &admin, s.Cfg.SupportedLocales)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// ---- tags ----

func (s *Server) adminListTags(w http.ResponseWriter, r *http.Request) {
	items, err := s.Dict.Tags(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) adminCreateTag(w http.ResponseWriter, r *http.Request) {
	var in dict.CreateTagInput
	if err := decodeBody(w, r, &in, 32<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	tag, err := s.Dict.CreateTag(r.Context(), in, &admin, s.Cfg.SupportedLocales)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, tag)
}

func (s *Server) adminPatchTag(w http.ResponseWriter, r *http.Request) {
	var in dict.TagPatchInput
	if err := decodeBody(w, r, &in, 32<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	tag, err := s.Dict.PatchTag(r.Context(), chi.URLParam(r, "slug"), in, &admin, s.Cfg.SupportedLocales)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, tag)
}

// ---- hot snapshots ----

func (s *Server) adminListHotSnapshots(w http.ResponseWriter, r *http.Request) {
	items, err := s.Hot.List(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) adminCreateHotSnapshot(w http.ResponseWriter, r *http.Request) {
	var in hot.CreateInput
	if err := decodeBody(w, r, &in, 256<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	snapshot, err := s.Hot.Create(r.Context(), in, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, snapshot)
}

func (s *Server) adminReviewHotSnapshot(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("id must be a UUID"))
		return
	}
	var in struct {
		Decision string `json:"decision"`
	}
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	snapshot, err := s.Hot.Review(r.Context(), id, in.Decision, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, snapshot)
}

func (s *Server) adminDeactivateHotSnapshot(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("id must be a UUID"))
		return
	}
	admin := s.adminID(r)
	snapshot, err := s.Hot.Deactivate(r.Context(), id, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, snapshot)
}

// ---- imports ----

func (s *Server) adminImportPreview(w http.ResponseWriter, r *http.Request) {
	var file imports.File
	// Strict decode: unknown top-level or row fields fail the whole batch
	// (PRD 09.3).
	if err := httpx.DecodeJSON(w, r, &file, 1<<20, true); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	previewID, rows, summary, err := s.Imports.Preview(r.Context(), file, s.adminID(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"previewId": previewID, "rows": rows, "summary": summary,
	})
}

func (s *Server) adminImportCommit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PreviewID string `json:"previewId"`
		ImportKey string `json:"importKey"`
	}
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	previewID, err := uuid.Parse(in.PreviewID)
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("previewId must be a UUID"))
		return
	}
	result, err := s.Imports.Commit(r.Context(), previewID, in.ImportKey, s.adminID(r))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (s *Server) adminGetImport(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("id must be a UUID"))
		return
	}
	result, err := s.Imports.Get(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}
