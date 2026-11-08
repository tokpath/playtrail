package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/events"
	"playtrail/backend/internal/httpx"
)

// adminDashboard assembles GET /admin/dashboard (§6.3). Crawler status is
// read straight from crawler_settings/sync_runs/crawler_quota — no crawler
// logic lives here.
func (s *Server) adminDashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := s.Catalog.Q

	counts := map[string]int{"draft": 0, "published": 0, "unlisted": 0}
	statusRows, err := q.CountGamesByStatus(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, row := range statusRows {
		counts[row.Status] = int(row.Count)
	}
	pendingReview, err := q.CountPendingReviewGames(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	suspectLinks, err := q.CountSuspectLinkGames(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	sourceChangesPending, err := q.CountPendingSourceChanges(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	liveLocales, err := s.Catalog.LiveLocales(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	crawler, err := s.crawlerStatus(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}

	var hotStatus any
	snapshots, err := s.Hot.List(ctx)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, snap := range snapshots {
		if snap.Active && snap.ReviewState == "approved" {
			fetched, _ := time.Parse(time.RFC3339, snap.SourceFetchedAt)
			stale := s.Catalog.Clock.Now().After(fetched.Add(48 * time.Hour))
			hotStatus = map[string]any{"sourceFetchedAt": snap.SourceFetchedAt, "stale": stale}
			break
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"counts": map[string]any{
			"draft":                counts["draft"],
			"published":            counts["published"],
			"unlisted":             counts["unlisted"],
			"pendingReview":        pendingReview,
			"suspectLinks":         suspectLinks,
			"sourceChangesPending": sourceChangesPending,
		},
		"liveLocales": liveLocales,
		"crawler":     crawler,
		"hot":         hotStatus,
	})
}

// adminStats serves GET /admin/stats.
func (s *Server) adminStats(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	report, err := s.Events.Stats(r.Context(), s.Cfg.OpsTimezone, events.StatsParams{
		From:   q.Get("from"),
		To:     q.Get("to"),
		GameID: q.Get("gameId"),
		Locale: q.Get("locale"),
	}, s.Cfg.SupportedLocales)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, report)
}

type auditItem struct {
	ID         int64          `json:"id"`
	AdminID    *uuid.UUID     `json:"adminId"`
	Actor      string         `json:"actor"`
	Action     string         `json:"action"`
	ObjectType string         `json:"objectType"`
	ObjectID   string         `json:"objectId"`
	Summary    map[string]any `json:"summary"`
	At         string         `json:"at"`
}

// adminAudit serves GET /admin/audit (50 rows per page).
func (s *Server) adminAudit(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	const pageSize = 50
	q := s.Catalog.Q
	total, err := q.CountAuditLog(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	rows, err := q.ListAuditLog(r.Context(), sqlc.ListAuditLogParams{RowLimit: int32(pageSize), RowOffset: int32((page - 1) * pageSize)})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	items := make([]auditItem, 0, len(rows))
	for _, row := range rows {
		var summary map[string]any
		if len(row.Summary) > 0 {
			_ = json.Unmarshal(row.Summary, &summary)
		}
		if summary == nil {
			summary = map[string]any{}
		}
		items = append(items, auditItem{
			ID: row.ID, AdminID: row.AdminID, Actor: row.Actor, Action: row.Action,
			ObjectType: row.ObjectType, ObjectID: row.ObjectID, Summary: summary,
			At: row.At.Format(time.RFC3339),
		})
	}
	totalPages := 0
	if total > 0 {
		totalPages = int((total + pageSize - 1) / pageSize)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": page, "pageSize": pageSize, "totalPages": totalPages,
	})
}
