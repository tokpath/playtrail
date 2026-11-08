package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
)

// AdminGame assembles the §6.3 AdminGame shape for one game.
func (s *Service) AdminGame(ctx context.Context, gameID uuid.UUID) (*AdminGame, error) {
	game, err := s.Q.GetGame(ctx, gameID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("game not found")
		}
		return nil, err
	}

	revID := game.DraftRevisionID
	if revID == nil {
		revID = game.PublishedRevisionID
	}
	if revID == nil {
		return nil, httpx.Internal("game has no revision")
	}
	rev, err := s.Q.GetRevision(ctx, *revID)
	if err != nil {
		return nil, err
	}
	localeRows, err := s.Q.ListRevisionLocales(ctx, rev.ID)
	if err != nil {
		return nil, err
	}
	states, err := s.Q.ListLocaleStates(ctx, game.ID)
	if err != nil {
		return nil, err
	}

	out := &AdminGame{
		ID:                     game.ID,
		Slug:                   game.Slug,
		Platform:               game.Platform,
		ExternalURL:            game.ExternalUrl,
		Status:                 game.Status,
		StatusReason:           game.StatusReason,
		LinkStatus:             game.LinkStatus,
		LinkCheckedAt:          timeString(game.LinkCheckedAt),
		LinkCheckMethod:        game.LinkCheckMethod,
		LinkCheckNote:          game.LinkCheckNote,
		OutboundDisabled:       game.OutboundDisabled,
		OutboundDisabledReason: game.OutboundDisabledReason,
		Featured:               game.Featured,
		EditorialOrder:         int(game.EditorialOrder),
		RevisionVersion:        int(game.RevisionVersion),
		CreatedAt:              game.CreatedAt.Format(time.RFC3339),
		UpdatedAt:              game.UpdatedAt.Format(time.RFC3339),
		Name:                   rev.Name,
		Developer:              rev.Developer,
		Tags:                   rev.Tags,
		DeviceSupport:          rev.DeviceSupport,
		DeviceEvidenceURL:      rev.DeviceEvidenceUrl,
		SourceURL:              rev.SourceUrl,
		SourceFetchedAt:        rev.SourceFetchedAt.Format(time.RFC3339),
		CoverAssetID:           rev.CoverAssetID,
		CoverSourcePath:        rev.CoverSourcePath,
		ScreenshotAssetIDs:     rev.ScreenshotAssetIds,
		UsePlaceholder:         rev.UsePlaceholder,
		MaterialReview:         rev.MaterialReview,
		Locales:                map[string]AdminGameLocale{},
		HasPendingChanges:      game.DraftRevisionID != nil,
	}
	out.FirstPublishedAt = timeString(game.FirstPublishedAt)
	if rev.PrimaryCategory.Valid {
		c := rev.PrimaryCategory.String
		out.PrimaryCategory = &c
	}
	if rev.DeviceCheckedAt != nil {
		out.DeviceCheckedAt = timeString(rev.DeviceCheckedAt)
	}

	stateBy := map[string]sqlc.GameLocaleState{}
	for _, st := range states {
		stateBy[st.Locale] = st
	}
	for _, r := range localeRows {
		al := AdminGameLocale{
			Alias:             r.Alias,
			Summary:           r.Summary,
			Description:       r.Description,
			Controls:          r.Controls,
			MediaAlt:          parseNames(r.MediaAlt),
			ContentReview:     r.ContentReview,
			TranslationMethod: r.TranslationMethod,
			ReviewedAt:        nil,
			LiveRevisionID:    nil,
			FirstPublishedAt:  nil,
			PublishedAt:       nil,
		}
		if r.ReviewedAt != nil {
			t := r.ReviewedAt.Format(time.RFC3339)
			al.ReviewedAt = &t
		}
		if st, ok := stateBy[r.Locale]; ok {
			al.Live = true
			liveID := st.LiveRevisionID
			al.LiveRevisionID = &liveID
			al.FirstPublishedAt = timeString(&st.FirstPublishedAt)
			al.PublishedAt = timeString(&st.PublishedAt)
		}
		out.Locales[r.Locale] = al
	}
	// Live locales without candidate-revision content still show as live keys.
	for slug, st := range stateBy {
		if _, ok := out.Locales[slug]; !ok {
			out.Locales[slug] = AdminGameLocale{Live: true, LiveRevisionID: &st.LiveRevisionID,
				FirstPublishedAt: timeString(&st.FirstPublishedAt), PublishedAt: timeString(&st.PublishedAt),
				MediaAlt: map[string]string{}}
		}
	}

	// Gates over the candidate revision's locales.
	gateLocales := make([]string, 0, len(out.Locales))
	for l := range out.Locales {
		gateLocales = append(gateLocales, l)
	}
	report, err := s.computeGates(ctx, s.Q, game, rev, gateLocales)
	if err != nil {
		return nil, err
	}
	out.Gates = report

	// Crawler source linkage (read-only; the crawler agent owns writes).
	src, err := s.Q.GetSourceGameRefByGameID(ctx, &game.ID)
	if err == nil {
		out.Source = &AdminGameSource{
			SourceGameID:    src.ID,
			LastFetchedAt:   timeString(src.LastFetchedAt),
			LastFetchResult: src.LastFetchResult,
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return out, nil
}

// AdminListParams are the GET /admin/games filters.
type AdminListParams struct {
	Status     string
	LinkStatus string
	Review     string
	Locale     string
	Q          string
	Page       int
	PageSize   int
}

// AdminGameList is the admin list response.
type AdminGameList struct {
	Items      []AdminGameRow `json:"items"`
	Total      int            `json:"total"`
	Page       int            `json:"page"`
	PageSize   int            `json:"pageSize"`
	TotalPages int            `json:"totalPages"`
}

// ListAdminGames returns the admin game list with risks (§6.3).
func (s *Service) ListAdminGames(ctx context.Context, p AdminListParams) (*AdminGameList, error) {
	fields := map[string]string{}
	if p.Status != "" {
		if err := enumOK(p.Status, "draft", "published", "unlisted"); err != nil {
			fields["status"] = err.Error()
		}
	}
	if p.LinkStatus != "" {
		if err := enumOK(p.LinkStatus, "unchecked", "valid", "suspect", "invalid"); err != nil {
			fields["linkStatus"] = err.Error()
		}
	}
	if p.Review != "" {
		if err := enumOK(p.Review, "needs_review", "approved"); err != nil {
			fields["review"] = err.Error()
		}
	}
	if p.Locale != "" && !s.IsSupported(p.Locale) {
		fields["locale"] = "unsupported locale"
	}
	if p.Page < 1 {
		fields["page"] = "must be at least 1"
	}
	if p.PageSize < 1 || p.PageSize > 200 {
		fields["pageSize"] = "must be 1-200"
	}
	if len(fields) > 0 {
		return nil, &httpx.Error{Status: 400, Code: httpx.CodeInvalidParam, Message: "invalid query parameters", FieldErrors: fields}
	}

	pattern := "%"
	if q := strings.TrimSpace(p.Q); q != "" {
		pattern = "%" + strings.ToLower(q) + "%"
	}
	args := sqlc.CountAdminGamesParams{
		Status: optTextParam(p.Status), LinkStatus: optTextParam(p.LinkStatus),
		Q: optTextParam(pattern), Locale: optTextParam(p.Locale), Review: optTextParam(p.Review),
	}
	total, err := s.Q.CountAdminGames(ctx, args)
	if err != nil {
		return nil, err
	}
	rows, err := s.Q.ListAdminGames(ctx, sqlc.ListAdminGamesParams{
		Status: optTextParam(p.Status), LinkStatus: optTextParam(p.LinkStatus),
		Q: optTextParam(pattern), Locale: optTextParam(p.Locale), Review: optTextParam(p.Review),
		RowLimit: int32(p.PageSize), RowOffset: int32((p.Page - 1) * p.PageSize),
	})
	if err != nil {
		return nil, err
	}

	now := s.Clock.Now()
	items := make([]AdminGameRow, 0, len(rows))
	for _, r := range rows {
		var locales map[string]AdminGameLocalesState
		_ = json.Unmarshal(r.Locales, &locales)

		var risks []string
		if (r.Status == "published" || r.Status == "unlisted") &&
			(r.LinkCheckedAt == nil || now.Sub(*r.LinkCheckedAt) > 7*24*time.Hour) {
			risks = append(risks, "link_check_stale")
		}
		if r.HasSourceChanges {
			risks = append(risks, "source_changed")
		}

		items = append(items, AdminGameRow{
			ID: r.ID, Slug: r.Slug, Name: r.Name, Status: r.Status,
			LinkStatus: r.LinkStatus, OutboundDisabled: r.OutboundDisabled,
			Featured: r.Featured, EditorialOrder: int(r.EditorialOrder),
			UpdatedAt:       r.UpdatedAt.Format(time.RFC3339),
			SourceFetchedAt: r.SourceFetchedAt.Format(time.RFC3339),
			LinkCheckedAt:   timeString(r.LinkCheckedAt),
			Locales:         locales, Risks: risks,
		})
	}
	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(p.PageSize) - 1) / int64(p.PageSize))
	}
	return &AdminGameList{Items: items, Total: int(total), Page: p.Page, PageSize: p.PageSize, TotalPages: totalPages}, nil
}

func enumOK(v string, allowed ...string) error {
	for _, a := range allowed {
		if v == a {
			return nil
		}
	}
	return errors.New("invalid value")
}
