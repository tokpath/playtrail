package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/media"
)

// crawlerStatus reads crawler state for the dashboard (§6.3). The crawler
// agent owns PATCH /admin/crawler and run triggering; this read path stays
// here so the dashboard works before the crawler lands.
func (s *Server) crawlerStatus(ctx context.Context) (map[string]any, error) {
	q := s.Catalog.Q
	settings, err := q.GetCrawlerSettings(ctx)
	if err != nil {
		return nil, err
	}
	var quota int32
	today := s.Clock.Now().In(s.Cfg.OpsTimezone).Format("2006-01-02")
	if day, err := time.ParseInLocation("2006-01-02", today, s.Cfg.OpsTimezone); err == nil {
		if qrow, err := q.GetCrawlerQuota(ctx, day); err == nil {
			quota = qrow
		}
	}
	runs, err := q.ListRecentSyncRuns(ctx)
	if err != nil {
		return nil, err
	}
	runItems := make([]map[string]any, 0, len(runs))
	for _, run := range runs {
		var statusCounts, stats map[string]any
		_ = json.Unmarshal(run.StatusCounts, &statusCounts)
		_ = json.Unmarshal(run.Stats, &stats)
		item := map[string]any{
			"id": run.ID, "task": run.Task, "startedAt": run.StartedAt,
			"requests": run.Requests, "statusCounts": statusCounts, "stats": stats,
			"outcome": run.Outcome, "abortReason": run.AbortReason, "parserVersion": run.ParserVersion,
		}
		if run.FinishedAt != nil {
			item["finishedAt"] = *run.FinishedAt
		} else {
			item["finishedAt"] = nil
		}
		runItems = append(runItems, item)
	}
	return map[string]any{
		"enabledEnv":         s.Cfg.CrawlerEnabled,
		"enabled":            settings.Enabled,
		"autoDisabled":       settings.AutoDisabled,
		"autoDisabledReason": settings.AutoDisabledReason,
		"dailyCap":           settings.DailyCap,
		"minIntervalMs":      settings.MinIntervalMs,
		"hotAutoPublish":     settings.HotAutoPublish,
		"quotaToday":         quota,
		"runs":               runItems,
	}, nil
}

// ---- media ----

// adminUploadMedia implements POST /admin/media: max 2 MB via
// MaxBytesReader, content sniffing, WebP re-encode (§5).
func (s *Server) adminUploadMedia(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, (2<<20)+(64<<10))
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		httpx.WriteError(w, r, httpx.PayloadTooLarge("upload exceeds the 2 MB limit"))
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("multipart field \"file\" is required"))
		return
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(file)
	if err != nil {
		httpx.WriteError(w, r, httpx.PayloadTooLarge("upload exceeds the 2 MB limit"))
		return
	}
	asset, err := s.Media.Upload(r.Context(), s.Catalog.Q, data)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, mediaAssetJSON(asset))
}

// mediaAssetJSON renders a media_assets row as the MediaAsset contract type
// (variants as a JSON array, not the raw jsonb bytes).
func mediaAssetJSON(a sqlc.MediaAsset) map[string]any {
	variants := media.ParseVariants(a.Variants)
	if variants == nil {
		variants = []media.Variant{}
	}
	return map[string]any{
		"id": a.ID, "sha256": a.Sha256, "width": a.Width, "height": a.Height,
		"variants":   variants,
		"rightsType": a.RightsType, "rightsEvidenceRef": a.RightsEvidenceRef,
		"rightsNote": a.RightsNote, "reviewState": a.ReviewState,
		"createdAt": a.CreatedAt.Format(time.RFC3339),
	}
}

// adminGetMedia returns one media asset for the admin UI (rights display).
func (s *Server) adminGetMedia(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("id must be a UUID"))
		return
	}
	asset, err := s.Catalog.Q.GetMediaAsset(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, r, httpx.NotFound("unknown media asset"))
		return
	}
	httpx.JSON(w, http.StatusOK, mediaAssetJSON(asset))
}

// adminPatchMedia updates rights and review state.
func (s *Server) adminPatchMedia(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.InvalidParam("id must be a UUID"))
		return
	}
	var in struct {
		RightsType        *string `json:"rightsType"`
		RightsEvidenceRef *string `json:"rightsEvidenceRef"`
		RightsNote        *string `json:"rightsNote"`
		ReviewState       *string `json:"reviewState"`
	}
	if err := decodeBody(w, r, &in, 8<<10); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	fields := map[string]string{}
	if in.RightsType != nil {
		if err := validateEnumField("rightsType", *in.RightsType, "original", "licensed", "unknown"); err != nil {
			mergeFields(fields, err)
		}
	}
	if in.ReviewState != nil {
		if err := validateEnumField("reviewState", *in.ReviewState, "pending", "approved", "rejected"); err != nil {
			mergeFields(fields, err)
		}
	}
	if len(fields) > 0 {
		httpx.WriteError(w, r, httpx.Validation(fields))
		return
	}
	asset, err := s.Catalog.Q.UpdateMediaAsset(r.Context(), sqlc.UpdateMediaAssetParams{
		ID:                id,
		RightsType:        optPgText(in.RightsType),
		RightsEvidenceRef: optPgText(in.RightsEvidenceRef),
		RightsNote:        optPgText(in.RightsNote),
		ReviewState:       optPgText(in.ReviewState),
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			httpx.WriteError(w, r, httpx.NotFound("unknown asset"))
			return
		}
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, mediaAssetJSON(asset))
}

// ---- small shared helpers for admin handlers ----

func optPgText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func mergeFields(into map[string]string, err error) {
	if apiErr, ok := err.(*httpx.Error); ok {
		for k, v := range apiErr.FieldErrors {
			into[k] = v
		}
	}
}
