package catalog

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/media"
	"playtrail/backend/internal/validate"
)

const gateMaxAge = 7 * 24 * time.Hour

// computeGates evaluates the game-level and locale-level publish gates of
// §4.2 against a candidate revision. It never mutates anything. Database
// failures surface as errors, not business failures.
func (s *Service) computeGates(ctx context.Context, q *sqlc.Queries, game sqlc.Game, rev sqlc.GameRevision, locales []string) (GateReport, error) {
	now := s.Clock.Now()
	report := GateReport{Locales: map[string]GateCheck{}}
	var failures []GateFailure
	add := func(field, msg string) {
		failures = append(failures, GateFailure{Field: field, Message: msg})
	}

	// 1. Shared required fields.
	if n := validate.Len(rev.Name); n < 1 || n > 150 {
		add("name", fmt.Sprintf("length must be 1-150 code points, got %d", n))
	}
	var category *sqlc.Category
	if !rev.PrimaryCategory.Valid {
		add("primaryCategory", "required")
	} else {
		row, err := q.GetCategory(ctx, rev.PrimaryCategory.String)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				add("primaryCategory", "unknown category")
			} else {
				return GateReport{}, err
			}
		} else {
			category = &row
		}
	}
	if len(rev.Tags) > 8 {
		add("tags", "at most 8 tags")
	}
	seen := map[string]bool{}
	var tagRows []sqlc.Tag
	for _, slug := range rev.Tags {
		if seen[slug] {
			add("tags", "duplicate tag "+slug)
			continue
		}
		seen[slug] = true
		row, err := q.GetTag(ctx, slug)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				add("tags", "unknown tag "+slug)
				continue
			}
			return GateReport{}, err
		}
		if !row.Active {
			add("tags", "tag is inactive: "+slug)
		}
		tagRows = append(tagRows, row)
	}
	if _, err := validate.HTTPSField("sourceUrl", rev.SourceUrl); err != nil {
		add("sourceUrl", "must be https")
	}
	if rev.SourceFetchedAt.After(now) {
		add("sourceFetchedAt", "cannot be in the future")
	} else if rev.SourceFetchedAt.Before(now.Add(-gateMaxAge)) {
		add("sourceFetchedAt", "older than 7 days")
	}

	// 2. Link status.
	if game.LinkStatus != "valid" {
		add("linkStatus", "must be valid (manually confirmed)")
	} else if game.LinkCheckedAt == nil || game.LinkCheckedAt.Before(now.Add(-gateMaxAge)) {
		add("linkCheckedAt", "missing or older than 7 days")
	}

	// 3. Material rights. CrazyGames covers (cover_source_path) are not
	// assets and never affect this gate (PRD 22.12).
	if rev.MaterialReview != "placeholder" && rev.MaterialReview != "approved" {
		add("materialReview", "must be placeholder or approved")
	}
	if rev.MaterialReview == "placeholder" && !rev.UsePlaceholder {
		add("materialReview", "placeholder review requires usePlaceholder")
	}
	assetByID, err := s.loadAssets(ctx, q, rev)
	if err != nil {
		return GateReport{}, err
	}
	for _, id := range usedAssetIDs(rev) {
		a, ok := assetByID[id]
		if !ok {
			add("materialReview", "missing asset "+id.String())
			continue
		}
		if !media.IsPublic(a) {
			add("materialReview", "asset "+id.String()+" is not cleared for public display")
		}
	}

	// 4. Device evidence.
	if rev.DeviceSupport != "unknown" {
		if rev.DeviceEvidenceUrl == "" {
			add("deviceEvidenceUrl", "required when device support is claimed")
		}
		if rev.DeviceCheckedAt == nil {
			add("deviceCheckedAt", "required when device support is claimed")
		}
	}

	report.Game = GateCheck{OK: len(failures) == 0, Failures: failures}

	// Locale gates.
	for _, locale := range locales {
		check, err := s.localeGate(ctx, q, rev, locale, category, tagRows)
		if err != nil {
			return GateReport{}, err
		}
		report.Locales[locale] = check
	}
	return report, nil
}

// localeGate checks one locale's content against PRD 8.2 and §4.2.
func (s *Service) localeGate(ctx context.Context, q *sqlc.Queries, rev sqlc.GameRevision, locale string, category *sqlc.Category, tagRows []sqlc.Tag) (GateCheck, error) {
	var failures []GateFailure
	add := func(field, msg string) {
		failures = append(failures, GateFailure{Field: "locales." + locale + "." + field, Message: msg})
	}

	row, err := q.GetRevisionLocale(ctx, sqlc.GetRevisionLocaleParams{RevisionID: rev.ID, Locale: locale})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			add("locale", "no content for this locale")
			return GateCheck{OK: false, Failures: failures}, nil
		}
		return GateCheck{}, err
	}
	limits := LimitsFor(locale)
	if n := validate.Len(row.Summary); n < limits.SummaryMin || n > limits.SummaryMax {
		add("summary", fmt.Sprintf("length must be %d-%d code points, got %d", limits.SummaryMin, limits.SummaryMax, n))
	}
	if n := validate.Len(row.Description); n < limits.DescMin || n > limits.DescMax {
		add("description", fmt.Sprintf("length must be %d-%d code points, got %d", limits.DescMin, limits.DescMax, n))
	}
	if n := validate.Len(row.Controls); n > limits.ControlsMax {
		add("controls", fmt.Sprintf("length must be at most %d code points, got %d", limits.ControlsMax, n))
	}
	if row.ContentReview != "approved" {
		add("contentReview", "not approved")
	}

	// Category and tags must have names in this locale.
	if category != nil && parseNames(category.Names)[locale] == "" {
		add("primaryCategory", "category has no "+locale+" name")
	}
	for _, t := range tagRows {
		if parseNames(t.Names)[locale] == "" {
			add("tags", "tag has no "+locale+" name: "+t.Slug)
		}
	}

	// Every used asset must have an alt in this locale.
	alt := parseNames(row.MediaAlt)
	for _, id := range usedAssetIDs(rev) {
		a, ok := alt[id.String()]
		if !ok || strings.TrimSpace(a) == "" {
			add("mediaAlt", "missing alt text for asset "+id.String())
			continue
		}
		if n := validate.Len(a); n < 1 || n > 150 {
			add("mediaAlt", "alt text for asset "+id.String()+" must be 1-150 code points")
		}
	}
	return GateCheck{OK: len(failures) == 0, Failures: failures}, nil
}

func usedAssetIDs(rev sqlc.GameRevision) []uuid.UUID {
	var ids []uuid.UUID
	if rev.CoverAssetID != nil {
		ids = append(ids, *rev.CoverAssetID)
	}
	ids = append(ids, rev.ScreenshotAssetIds...)
	return ids
}

// loadAssets loads the assets a revision references. A missing asset is a
// business condition for callers; a database failure is an error.
func (s *Service) loadAssets(ctx context.Context, q *sqlc.Queries, rev sqlc.GameRevision) (map[uuid.UUID]sqlc.MediaAsset, error) {
	byID := map[uuid.UUID]sqlc.MediaAsset{}
	ids := usedAssetIDs(rev)
	if len(ids) == 0 {
		return byID, nil
	}
	rows, err := q.ListMediaAssets(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, a := range rows {
		byID[a.ID] = a
	}
	return byID, nil
}

// buildCover produces the public cover of a revision by precedence (§4.3):
// approved own asset, then CrazyGames cover (when enabled), then null.
func (s *Service) buildCover(rev sqlc.GameRevision, assets map[uuid.UUID]sqlc.MediaAsset, alt string) *media.Image {
	if rev.CoverAssetID != nil {
		if a, ok := assets[*rev.CoverAssetID]; ok {
			if img := s.Media.PublicImage(a, alt); img != nil {
				return img
			}
		}
	}
	if rev.CoverSourcePath != "" && s.ExternalCovers {
		return media.CrazyGamesImage(rev.CoverSourcePath, alt)
	}
	return nil
}

// GateReportFor returns the gate report for explicit locales (or the
// candidate revision's locales when locales is empty).
func (s *Service) GateReportFor(ctx context.Context, gameID uuid.UUID, locales []string) (*GateReport, error) {
	game, rev, err := s.candidateRevision(ctx, s.Q, gameID)
	if err != nil {
		return nil, err
	}
	if len(locales) == 0 {
		rows, err := s.Q.ListRevisionLocales(ctx, rev.ID)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			locales = append(locales, r.Locale)
		}
	}
	report, err := s.computeGates(ctx, s.Q, game, rev, locales)
	if err != nil {
		return nil, err
	}
	return &report, nil
}

// candidateRevisionFor returns the revision a patch/publish targets for an
// already-loaded (row-locked) game: the draft when present, otherwise the
// published revision (re-publish or locale-only publish, §4.1/§4.2).
func candidateRevisionFor(ctx context.Context, q *sqlc.Queries, game sqlc.Game) (sqlc.GameRevision, error) {
	revID := game.DraftRevisionID
	if revID == nil {
		revID = game.PublishedRevisionID
	}
	if revID == nil {
		return sqlc.GameRevision{}, httpx.Validation(map[string]string{"id": "game has no revision"})
	}
	return q.GetRevision(ctx, *revID)
}

// candidateRevision loads the game by ID and resolves its candidate revision.
func (s *Service) candidateRevision(ctx context.Context, q *sqlc.Queries, gameID uuid.UUID) (sqlc.Game, sqlc.GameRevision, error) {
	game, err := q.GetGame(ctx, gameID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sqlc.Game{}, sqlc.GameRevision{}, httpx.NotFound("game not found")
		}
		return sqlc.Game{}, sqlc.GameRevision{}, err
	}
	rev, err := candidateRevisionFor(ctx, q, game)
	if err != nil {
		return sqlc.Game{}, sqlc.GameRevision{}, err
	}
	return game, rev, nil
}
