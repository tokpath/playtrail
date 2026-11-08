package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"playtrail/backend/internal/crawler"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/validate"
)

// ---- source catalog (PRD 22.5) ----

func (s *Server) adminListSourceGames(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := intParam(q.Get("page"), 1)
	pageSize := intParam(q.Get("pageSize"), 24)

	var mobile, collected, hasDetail *bool
	if v := q.Get("mobile"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			httpx.WriteError(w, r, httpx.InvalidParam("mobile must be a boolean"))
			return
		}
		mobile = &b
	}
	if v := q.Get("collected"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			httpx.WriteError(w, r, httpx.InvalidParam("collected must be a boolean"))
			return
		}
		collected = &b
	}
	if v := q.Get("detail"); v != "" && v != "yes" && v != "no" {
		httpx.WriteError(w, r, httpx.InvalidParam("detail must be yes or no"))
		return
	} else if v != "" {
		b := v == "yes"
		hasDetail = &b
	}
	category := q.Get("category")
	if category != "" {
		if _, err := s.Catalog.Q.GetCategory(r.Context(), category); err != nil {
			httpx.WriteError(w, r, httpx.InvalidParam("unknown category"))
			return
		}
	}

	ctx := r.Context()
	filters := sourceGameArgs(q.Get("q"), category, mobile, collected, hasDetail)
	countArgs := sqlc.CountSourceGamesParams{
		Q: filters.Q, Category: filters.Category, Mobile: filters.Mobile,
		Collected: filters.Collected, HasDetail: filters.HasDetail,
	}
	total, err := s.Catalog.Q.CountSourceGames(ctx, countArgs)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	filters.RowLimit, filters.RowOffset = int32(pageSize), int32((page-1)*pageSize)
	rows, err := s.Catalog.Q.ListSourceGames(ctx, filters)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, sourceGameRowJSON(row))
	}
	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": page, "pageSize": pageSize, "totalPages": totalPages,
	})
}

func (s *Server) adminGetSourceGame(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("id must be a UUID"))
		return
	}
	sg, err := s.Catalog.Q.GetSourceGame(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, httpx.NotFound("unknown source game"))
		return
	}
	httpx.JSON(w, http.StatusOK, sourceGameJSON(sg))
}

func (s *Server) adminCollectSourceGame(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("id must be a UUID"))
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.CollectSourceGame(r.Context(), id, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, game)
}

// ---- detected source changes (PRD 22.7) ----

func (s *Server) adminListSourceChanges(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page := intParam(q.Get("page"), 1)
	pageSize := intParam(q.Get("pageSize"), 24)
	state := q.Get("state")
	if state != "" && state != "pending" && state != "accepted" && state != "ignored" {
		httpx.WriteError(w, r, httpx.InvalidParam("state must be pending, accepted, or ignored"))
		return
	}
	ctx := r.Context()
	changeState := filterPgText(state)
	total, err := s.Catalog.Q.CountSourceChanges(ctx, changeState)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	rows, err := s.Catalog.Q.ListSourceChanges(ctx, sqlc.ListSourceChangesParams{
		State: filterPgText(state), RowLimit: int32(pageSize), RowOffset: int32((page - 1) * pageSize),
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, sourceChangeJSON(row))
	}
	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": page, "pageSize": pageSize, "totalPages": totalPages,
	})
}

func (s *Server) adminResolveSourceChange(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("id must be a UUID"))
		return
	}
	var in struct {
		Action          string `json:"action"`
		RevisionVersion *int   `json:"revisionVersion"`
	}
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	admin := s.adminID(r)
	game, err := s.Catalog.ApplySourceChange(r.Context(), id, in.Action, in.RevisionVersion, &admin)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, game)
}

// ---- tag mappings (PRD 22.11) ----

func (s *Server) adminListTagMappings(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Catalog.Q.ListTagMappings(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": tagMappingsJSON(rows)})
}

func (s *Server) adminPutTagMapping(w http.ResponseWriter, r *http.Request) {
	sourceSlug := chi.URLParam(r, "sourceTagSlug")
	if !validate.SlugOK(sourceSlug) {
		httpx.WriteError(w, r, httpx.InvalidParam("sourceTagSlug must match the CG slug shape"))
		return
	}
	var in struct {
		TagSlug *string `json:"tagSlug"`
	}
	if err := decodeBody(w, r, &in, 4<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var tagSlug pgtype.Text
	if in.TagSlug != nil {
		if _, err := s.Catalog.Q.GetTag(r.Context(), *in.TagSlug); err != nil {
			httpx.WriteError(w, r, httpx.Validation(map[string]string{"tagSlug": "unknown tag"}))
			return
		}
		tagSlug = pgtype.Text{String: *in.TagSlug, Valid: true}
	}
	mappingArgs := sqlc.UpsertTagMappingParams{SourceTagSlug: sourceSlug, TagSlug: tagSlug}
	row, err := s.Catalog.Q.UpsertTagMapping(r.Context(), mappingArgs)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	rows, err := s.Catalog.Q.ListTagMappings(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": tagMappingsJSON(rows), "saved": row.SourceTagSlug})
}

// ---- crawler settings and manual runs (PRD 22.4.8, 22.10) ----

func (s *Server) adminGetCrawler(w http.ResponseWriter, r *http.Request) {
	status, err := s.crawlerStatus(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, status)
}

func (s *Server) adminPatchCrawler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled        *bool `json:"enabled"`
		DailyCap       *int  `json:"dailyCap"`
		MinIntervalMs  *int  `json:"minIntervalMs"`
		HotAutoPublish *bool `json:"hotAutoPublish"`
	}
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	fields := map[string]string{}
	if in.DailyCap != nil && *in.DailyCap < 0 {
		fields["dailyCap"] = "must be non-negative"
	}
	if in.MinIntervalMs != nil && *in.MinIntervalMs < 2000 {
		fields["minIntervalMs"] = "must be at least 2000"
	}
	if len(fields) > 0 {
		httpx.WriteError(w, r, httpx.Validation(fields))
		return
	}
	clearsAutoDisabled := in.Enabled != nil && *in.Enabled
	args := sqlc.UpdateCrawlerSettingsParams{
		Enabled:        optPgBool(in.Enabled),
		DailyCap:       optPgInt4(in.DailyCap),
		MinIntervalMs:  optPgInt4(in.MinIntervalMs),
		HotAutoPublish: optPgBool(in.HotAutoPublish),
	}
	if clearsAutoDisabled {
		args.AutoDisabled = pgtype.Bool{Bool: false, Valid: true}
		args.AutoDisabledReason = pgtype.Text{String: "", Valid: true}
		args.ConsecutiveAborts = pgtype.Int4{Int32: 0, Valid: true}
	}
	settings, err := s.Catalog.Q.UpdateCrawlerSettings(r.Context(), args)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	s.Log.Info("crawler settings updated", "enabled", settings.Enabled,
		"autoDisabled", settings.AutoDisabled, "dailyCap", settings.DailyCap)
	status, err := s.crawlerStatus(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, status)
}

// adminRunCrawler triggers one task run asynchronously (202; the advisory
// lock prevents concurrent runs of the same task).
func (s *Server) adminRunCrawler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Task string `json:"task"`
	}
	if err := decodeBody(w, r, &in, 4<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !crawler.ValidTask(in.Task) {
		httpx.WriteError(w, r, httpx.InvalidParam("task must be sitemap, tracked, backfill, or hot"))
		return
	}
	runCtx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	go func() {
		defer cancel()
		if _, err := s.Crawler.RunTask(runCtx, in.Task); err != nil {
			s.Log.Warn("manual crawl failed", "task", in.Task, "error", err)
		}
	}()
	w.WriteHeader(http.StatusAccepted)
}

// ---- JSON rendering and filter helpers ----

func sourceGameArgs(q, category string, mobile, collected, hasDetail *bool) sqlc.ListSourceGamesParams {
	return sqlc.ListSourceGamesParams{
		Q:         filterPgText(q),
		Category:  filterPgText(category),
		Mobile:    optPgBool(mobile),
		Collected: optPgBool(collected),
		HasDetail: optPgBool(hasDetail),
	}
}

func tagMappingsJSON(rows []sqlc.TagMapping) []map[string]any {
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		var tagSlug *string
		if row.TagSlug.Valid {
			v := row.TagSlug.String
			tagSlug = &v
		}
		items = append(items, map[string]any{"sourceTagSlug": row.SourceTagSlug, "tagSlug": tagSlug})
	}
	return items
}

// sourceGameRowJSON renders one source-catalog row (no reference material).
func sourceGameRowJSON(row sqlc.SourceGame) map[string]any {
	m := sourceGameJSON(row)
	delete(m, "reference")
	delete(m, "raw")
	return m
}

// sourceGameJSON renders a source game; reference/raw are backend-only data
// exposed to the admin UI per PRD 22.5 and never on public surfaces.
func sourceGameJSON(sg sqlc.SourceGame) map[string]any {
	var sourceID *string
	if sg.SourceID.Valid {
		v := sg.SourceID.String
		sourceID = &v
	}
	isMultiplayer := sg.IsMultiplayer.Valid && sg.IsMultiplayer.Bool
	return map[string]any{
		"id": sg.ID, "sourceId": sourceID, "slug": sg.Slug, "name": sg.Name,
		"categorySlug": sg.CategorySlug, "tags": jsonObj(sg.Tags), "developer": sg.Developer,
		"deviceFlags": jsonObj(sg.DeviceFlags), "isMultiplayer": isMultiplayer,
		"mobile":  suggestMobile(sg.DeviceFlags),
		"addedOn": dateOrNil(sg.AddedOn), "lastSignificantUpdatedOn": dateOrNil(sg.LastSignificantUpdatedOn),
		"sourceStatus": sg.SourceStatus,
		"rating":       numericOrNil(sg.Rating), "upvotes": int8OrNil(sg.Upvotes), "downvotes": int8OrNil(sg.Downvotes),
		"localeUrls": jsonObj(sg.LocaleUrls), "coverPath": sg.CoverPath,
		"reference": jsonObj(sg.Reference), "raw": jsonObj(sg.Raw),
		"firstSeenAt":         sg.FirstSeenAt.Format(time.RFC3339),
		"lastSeenInSitemapAt": timeOrNil(sg.LastSeenInSitemapAt),
		"sitemapMissingCount": sg.SitemapMissingCount,
		"lastFetchedAt":       timeOrNil(sg.LastFetchedAt), "lastFetchResult": sg.LastFetchResult,
		"consecutiveFailDays": sg.ConsecutiveFailDays,
		"collected":           sg.GameID != nil, "gameId": sg.GameID,
		"hasDetail": sg.ParserVersion > 0,
	}
}

func sourceChangeJSON(row sqlc.ListSourceChangesRow) map[string]any {
	m := map[string]any{
		"id": row.ID, "gameId": row.GameID, "gameSlug": row.GameSlug, "field": row.Field,
		"oldValue": jsonObj(row.OldValue), "newValue": jsonObj(row.NewValue),
		"detectedAt": row.DetectedAt.Format(time.RFC3339), "state": row.State,
	}
	if row.ResolvedAt != nil {
		m["resolvedAt"] = row.ResolvedAt.Format(time.RFC3339)
	} else {
		m["resolvedAt"] = nil
	}
	return m
}

func jsonObj(raw []byte) any {
	var v any
	if len(raw) == 0 || json.Unmarshal(raw, &v) != nil {
		return nil
	}
	return v
}

func dateOrNil(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Format("2006-01-02")
}

func timeOrNil(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Format(time.RFC3339)
}

func numericOrNil(n pgtype.Numeric) any {
	if !n.Valid {
		return nil
	}
	f, _ := n.Float64Value()
	if !f.Valid {
		return nil
	}
	return f.Float64
}

func int8OrNil(n pgtype.Int8) any {
	if !n.Valid {
		return nil
	}
	return n.Int64
}

func optPgBool(b *bool) pgtype.Bool {
	if b == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *b, Valid: true}
}

func optPgInt4(n *int) pgtype.Int4 {
	if n == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*n), Valid: true}
}

// Text filters drop empty query parameters; PATCH helpers keep empty strings
// meaningful so callers can still clear a text field.
func filterPgText(value string) pgtype.Text {
	if value == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}

func suggestMobile(raw []byte) bool {
	var flags map[string]bool
	_ = json.Unmarshal(raw, &flags)
	return flags["ios"] || flags["android"]
}
