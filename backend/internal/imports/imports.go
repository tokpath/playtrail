// Package imports implements the JSON import contract (PRD 09): strict
// top-level validation, per-row preview with normalized rows, and an
// idempotent commit keyed by importKey. Valid rows commit atomically in one
// transaction.
package imports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"playtrail/backend/internal/audit"
	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/clock"
	"playtrail/backend/internal/db"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/validate"
)

const (
	maxBatchRows = 200
	maxAliasLen  = 100
)

// File is the top-level import document. Unknown top-level fields make the
// whole batch fail (strict decode in the handler).
type File struct {
	SchemaVersion int             `json:"schemaVersion"`
	Games         []GameImportRow `json:"games"`
}

// GameImportRow is one import row. Unknown row fields are rejected by the
// strict decoder and reported as UNKNOWN_FIELD rows.
type GameImportRow struct {
	Name            string                  `json:"name"`
	Slug            *string                 `json:"slug"`
	PrimaryCategory string                  `json:"primaryCategory"`
	Tags            []string                `json:"tags"`
	ExternalURL     string                  `json:"externalURL"`
	SourceURL       string                  `json:"sourceURL"`
	SourceFetchedAt string                  `json:"sourceFetchedAt"`
	CoverSourcePath *string                 `json:"coverSourcePath"`
	Locales         map[string]LocaleImport `json:"locales"`
}

// LocaleImport is one locale's draft content.
type LocaleImport struct {
	Alias       *string `json:"alias"`
	Summary     *string `json:"summary"`
	Description *string `json:"description"`
	Controls    *string `json:"controls"`
}

// Row is the per-row preview/commit result (PRD 09.5).
type Row struct {
	Line      int        `json:"line"`
	Name      string     `json:"name"`
	Status    string     `json:"status"` // created | duplicate | failed
	GameID    *uuid.UUID `json:"gameId"`
	ErrorCode *string    `json:"errorCode"`
	Message   *string    `json:"message"`
}

// Summary aggregates row statuses.
type Summary struct {
	Total     int `json:"total"`
	Created   int `json:"created"`
	Duplicate int `json:"duplicate"`
	Failed    int `json:"failed"`
}

func summarize(rows []Row) Summary {
	s := Summary{Total: len(rows)}
	for _, r := range rows {
		switch r.Status {
		case "created":
			s.Created++
		case "duplicate":
			s.Duplicate++
		case "failed":
			s.Failed++
		}
	}
	return s
}

// normalizedRow is stored as the import job payload, so the fields are
// exported with JSON tags for the preview → commit round trip.
type normalizedRow struct {
	Line            int                            `json:"line"`
	Name            string                         `json:"name"`
	Slug            string                         `json:"slug"`
	Category        string                         `json:"category"`
	Tags            []string                       `json:"tags"`
	ExternalURL     string                         `json:"externalURL"`
	SourceURL       string                         `json:"sourceURL"`
	FetchedAt       string                         `json:"fetchedAt"`
	CoverSourcePath string                         `json:"coverSourcePath"`
	Locales         map[string]catalog.LocalePatch `json:"locales"`
}

type Service struct {
	Catalog *catalog.Service
	Locales []string
	Clock   clock.Clock
}

// Preview validates the whole file, normalizes rows, stores the job, and
// returns the per-row preview.
func (s *Service) Preview(ctx context.Context, file File, adminID uuid.UUID) (uuid.UUID, []Row, Summary, error) {
	if file.SchemaVersion != 1 {
		return uuid.Nil, nil, Summary{}, httpx.InvalidParam("schemaVersion must be 1")
	}
	if len(file.Games) > maxBatchRows {
		return uuid.Nil, nil, Summary{}, httpx.InvalidParam(fmt.Sprintf("at most %d rows per batch", maxBatchRows))
	}
	rows := s.validateRows(ctx, s.Catalog.Q, file.Games)
	payload, _ := json.Marshal(rows.normalized)
	preview, _ := json.Marshal(rows.results)
	job, err := s.Catalog.Q.InsertImportJob(ctx, sqlc.InsertImportJobParams{
		Payload: payload, Preview: preview, CreatedBy: adminID,
	})
	if err != nil {
		return uuid.Nil, nil, Summary{}, err
	}
	return job.ID, rows.results, summarize(rows.results), nil
}

type validated struct {
	results    []Row
	normalized []normalizedRow
}

// validateRows checks each row and returns per-row results plus normalized
// rows for the payload. In-file duplicates of URL or provided slug fail the
// row; valid rows are marked "created" (anticipated at commit).
func (s *Service) validateRows(ctx context.Context, q *sqlc.Queries, in []GameImportRow) validated {
	var out validated
	seenURL := map[string]bool{}
	seenSlug := map[string]bool{}
	for i, r := range in {
		line := i + 1
		row := Row{Line: line, Name: r.Name}
		fields := s.rowFieldErrors(ctx, q, r, seenURL, seenSlug)
		if len(fields) > 0 {
			// Rows that are only duplicates get the dedicated "duplicate"
			// status (PRD 09), matching what commit reports.
			dupOnly := true
			for k := range fields {
				if k != "DUPLICATE" {
					dupOnly = false
				}
			}
			if dupOnly {
				var keys, first string
				for k, v := range fields {
					keys += k + " "
					if first == "" {
						first = v
					}
				}
				row.Status = "duplicate"
				code := "DUPLICATE"
				row.ErrorCode = &code
				msg := fmt.Sprintf("%s [%s]", strings.TrimSpace(first), strings.TrimSpace(keys))
				row.Message = &msg
				out.results = append(out.results, row)
				continue
			}
			row.Status = "failed"
			code := "INVALID_ROW"
			row.ErrorCode = &code
			var keys, first string
			for k, v := range fields {
				keys += k + " "
				if first == "" {
					first = k + ": " + v
				}
			}
			msg := fmt.Sprintf("%s [%s]", strings.TrimSpace(first), strings.TrimSpace(keys))
			row.Message = &msg
			out.results = append(out.results, row)
			continue
		}
		external, _ := validate.NormalizeGameURL("externalURL", r.ExternalURL)
		seenURL[external] = true
		if r.Slug != nil {
			seenSlug[*r.Slug] = true
		}
		nr := normalizedRow{
			Line:            line,
			Name:            r.Name,
			Category:        r.PrimaryCategory,
			Tags:            nonNil(r.Tags),
			ExternalURL:     external,
			SourceURL:       r.SourceURL,
			FetchedAt:       r.SourceFetchedAt,
			CoverSourcePath: deref(r.CoverSourcePath),
			Locales:         map[string]catalog.LocalePatch{},
		}
		if r.Slug != nil {
			nr.Slug = *r.Slug
		}
		for locale, l := range r.Locales {
			nr.Locales[locale] = catalog.LocalePatch{
				Alias:       l.Alias,
				Summary:     l.Summary,
				Description: l.Description,
				Controls:    l.Controls,
			}
		}
		out.normalized = append(out.normalized, nr)
		row.Status = "created"
		out.results = append(out.results, row)
	}
	return out
}

// urlTaken reports whether a normalized external URL already exists in the
// catalog. Preview and commit dedupe through this one lookup (E12).
func urlTaken(ctx context.Context, q *sqlc.Queries, external string) bool {
	_, err := q.GetGameByExternalURL(ctx, external)
	return err == nil
}

// rowFieldErrors collects row-level validation failures using the PRD 09
// sub-code vocabulary (INVALID_URL, UNKNOWN_CATEGORY, ...).
func (s *Service) rowFieldErrors(ctx context.Context, q *sqlc.Queries, r GameImportRow, seenURL, seenSlug map[string]bool) map[string]string {
	fields := map[string]string{}
	fail := func(code, msg string) { fields[code] = msg }
	if validate.Len(r.Name) < 1 || validate.Len(r.Name) > 150 {
		fail("MISSING_REQUIRED", "name required (1-150 code points)")
	}
	external, err := validate.NormalizeGameURL("externalURL", r.ExternalURL)
	if err != nil {
		fail("INVALID_URL", "externalURL is not a valid CrazyGames game URL")
	} else if seenURL[external] {
		fail("DUPLICATE", "duplicate externalURL within the file")
	} else if urlTaken(ctx, q, external) {
		fail("DUPLICATE", "externalURL already exists in the catalog")
	}
	if _, err := validate.HTTPSField("sourceURL", r.SourceURL); err != nil {
		fail("INVALID_URL", "sourceURL must be https")
	}
	if _, err := validate.TimeField("sourceFetchedAt", r.SourceFetchedAt, s.Clock.Now(), 0, false); err != nil {
		if apiErr, ok := err.(*httpx.Error); ok && apiErr.FieldErrors["sourceFetchedAt"] == "cannot be in the future" {
			fail("FUTURE_TIME", "sourceFetchedAt cannot be in the future")
		} else {
			fail("INVALID_TIME", "sourceFetchedAt must be RFC 3339 with offset")
		}
	}
	if _, err := q.GetCategory(ctx, r.PrimaryCategory); err != nil {
		fail("UNKNOWN_CATEGORY", "unknown primaryCategory")
	}
	if len(r.Tags) > 8 {
		fail("UNKNOWN_TAG", "at most 8 tags")
	}
	seen := map[string]bool{}
	for _, t := range r.Tags {
		if seen[t] {
			fail("UNKNOWN_TAG", "duplicate tag "+t)
			break
		}
		seen[t] = true
		if _, err := q.GetTag(ctx, t); err != nil {
			fail("UNKNOWN_TAG", "unknown tag "+t)
			break
		}
	}
	if r.CoverSourcePath != nil {
		if _, err := validate.CoverSourcePathField("coverSourcePath", *r.CoverSourcePath); err != nil {
			fail("INVALID_ROW", "invalid coverSourcePath")
		}
	}
	if r.Slug != nil && *r.Slug != "" {
		if err := validate.SlugField("slug", *r.Slug); err != nil {
			fail("INVALID_ROW", "invalid slug")
		} else if _, err := q.GetGameBySlug(ctx, *r.Slug); err == nil {
			fail("DUPLICATE", "slug already exists in the catalog")
		} else if seenSlug[*r.Slug] {
			fail("DUPLICATE", "duplicate slug within the file")
		}
	}
	for locale, l := range r.Locales {
		supported := false
		for _, sl := range s.Locales {
			if sl == locale {
				supported = true
			}
		}
		if !supported {
			fail("UNSUPPORTED_LOCALE", "unsupported locale "+locale)
			continue
		}
		limits := catalog.LimitsFor(locale)
		check := func(name string, v *string, max int) {
			if v != nil && validate.Len(*v) > max {
				fail("FIELD_TOO_LONG", fmt.Sprintf("%s.%s exceeds %d code points", locale, name, max))
			}
		}
		check("alias", l.Alias, maxAliasLen)
		check("summary", l.Summary, limits.SummaryMax)
		check("description", l.Description, limits.DescMax)
		check("controls", l.Controls, limits.ControlsMax)
	}
	return fields
}

// CommitResult is the commit/GET response (§6.3).
type CommitResult struct {
	JobID   uuid.UUID `json:"jobId"`
	Rows    []Row     `json:"rows"`
	Summary Summary   `json:"summary"`
	Code    string    `json:"code,omitempty"`
}

// Commit creates drafts for the valid rows of a previewed job in a single
// transaction. Resubmitting the same importKey returns the stored result
// with the IMPORT_KEY_REUSED hint code (PRD 09.1).
func (s *Service) Commit(ctx context.Context, previewID uuid.UUID, importKey string, adminID uuid.UUID) (*CommitResult, error) {
	if importKey == "" {
		return nil, httpx.InvalidParam("importKey is required")
	}
	job, err := s.Catalog.Q.GetImportJob(ctx, previewID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("unknown previewId")
		}
		return nil, err
	}
	if job.ImportKey.Valid && job.ImportKey.String == importKey {
		return s.storedResult(ctx, job)
	}
	if job.State != "previewed" {
		return nil, httpx.Validation(map[string]string{"previewId": "job is not in previewed state"})
	}
	var payload []normalizedRow
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		return nil, httpx.Internal("corrupt import payload")
	}

	var rows []Row
	err = db.InTx(ctx, s.Catalog.Pool, func(q *sqlc.Queries) error {
		rows = rows[:0]
		for _, nr := range payload {
			row := Row{Line: nr.Line, Name: nr.Name}
			if urlTaken(ctx, q, nr.ExternalURL) {
				code, msg := "DUPLICATE", "externalURL already exists in the catalog"
				row.Status, row.ErrorCode, row.Message = "duplicate", &code, &msg
				rows = append(rows, row)
				continue
			}
			gameID, err := s.createDraft(ctx, q, nr)
			if err != nil {
				return err // rolls back the whole batch (PRD 09.4)
			}
			row.Status = "created"
			row.GameID = &gameID
			rows = append(rows, row)
		}
		// 22.5: link fresh drafts to their source rows by external URL.
		if _, err := q.LinkSourceGamesByExternalURL(ctx); err != nil {
			return err
		}
		result, _ := json.Marshal(rows)
		if _, err := q.CommitImportJob(ctx, sqlc.CommitImportJobParams{
			ID: previewID, ImportKey: pgTextOpt(importKey), Result: result,
		}); err != nil {
			return err
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: &adminID, Actor: "import", Action: "import.commit",
			ObjectType: "import_job", ObjectID: previewID.String(),
			Summary: jsonSummary(map[string]any{"importKey": importKey, "rows": len(rows)}),
		})
	})
	if err != nil {
		// A concurrent commit claimed the same key: return its stored result.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			if existing, gerr := s.Catalog.Q.GetImportJobByKey(ctx, pgTextOpt(importKey)); gerr == nil {
				return s.storedResult(ctx, existing)
			}
		}
		return nil, err
	}
	return &CommitResult{JobID: previewID, Rows: rows, Summary: summarize(rows)}, nil
}

// Get returns a stored commit result.
func (s *Service) Get(ctx context.Context, jobID uuid.UUID) (*CommitResult, error) {
	job, err := s.Catalog.Q.GetImportJob(ctx, jobID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("unknown import job")
		}
		return nil, err
	}
	return s.storedResult(ctx, job)
}

func (s *Service) storedResult(_ context.Context, job sqlc.ImportJob) (*CommitResult, error) {
	if job.Result == nil {
		return nil, httpx.Validation(map[string]string{"id": "job has not been committed"})
	}
	var rows []Row
	if err := json.Unmarshal(job.Result, &rows); err != nil {
		return nil, httpx.Internal("corrupt import result")
	}
	return &CommitResult{JobID: job.ID, Rows: rows, Summary: summarize(rows), Code: "IMPORT_KEY_REUSED"}, nil
}

// createDraft inserts one game + revision + locale rows (created_by='import',
// status draft, all reviews pending — PRD 09.6).
func (s *Service) createDraft(ctx context.Context, q *sqlc.Queries, nr normalizedRow) (uuid.UUID, error) {
	fetchedAt, err := validate.TimeField("sourceFetchedAt", nr.FetchedAt, s.Clock.Now(), 0, false)
	if err != nil {
		return uuid.Nil, err
	}
	slug := nr.Slug
	if slug == "" {
		slug = validate.GameSlugFromName(nr.Name)
	}
	slug, err = uniqueSlug(ctx, q, slug)
	if err != nil {
		return uuid.Nil, err
	}

	game, err := q.InsertGame(ctx, sqlc.InsertGameParams{Slug: slug, ExternalUrl: nr.ExternalURL})
	if err != nil {
		return uuid.Nil, err
	}
	rev, err := q.InsertRevision(ctx, sqlc.InsertRevisionParams{
		GameID: game.ID, Name: nr.Name, PrimaryCategory: pgTextPtr(nr.Category),
		Tags: nr.Tags, SourceUrl: nr.SourceURL, SourceFetchedAt: fetchedAt,
		CoverSourcePath: nr.CoverSourcePath,
		DeviceSupport:   "unknown", ScreenshotAssetIds: []uuid.UUID{},
		UsePlaceholder: true, MaterialReview: "placeholder", CreatedBy: "import",
	})
	if err != nil {
		return uuid.Nil, err
	}
	if err := q.SetGameDraftRevision(ctx, sqlc.SetGameDraftRevisionParams{ID: game.ID, RevisionID: &rev.ID}); err != nil {
		return uuid.Nil, err
	}
	for locale, lp := range nr.Locales {
		if _, err := q.UpsertRevisionLocale(ctx, sqlc.UpsertRevisionLocaleParams{
			RevisionID: rev.ID, Locale: locale,
			Alias:             deref(lp.Alias),
			Summary:           deref(lp.Summary),
			Description:       deref(lp.Description),
			Controls:          deref(lp.Controls),
			MediaAlt:          []byte("{}"),
			ContentReview:     "pending",
			TranslationMethod: "original",
		}); err != nil {
			return uuid.Nil, err
		}
	}
	return game.ID, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func uniqueSlug(ctx context.Context, q *sqlc.Queries, slug string) (string, error) {
	base := slug
	for i := 0; ; i++ {
		_, err := q.GetGameBySlug(ctx, slug)
		if errors.Is(err, pgx.ErrNoRows) {
			return slug, nil
		}
		if err != nil {
			return "", err
		}
		if i >= 20 {
			return "", fmt.Errorf("could not derive a unique slug")
		}
		suffix := uuid.NewString()[:6]
		if len(base)+1+len(suffix) > 100 {
			base = base[:100-1-len(suffix)]
		}
		slug = base + "-" + suffix
	}
}

// pgTextOpt maps an empty key to SQL NULL for the nullable import_key column.
func pgTextOpt(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func jsonSummary(v any) []byte {
	raw, _ := json.Marshal(v)
	return raw
}

// pgTextPtr builds a nullable text param: NULL when empty (draft categories
// may be unset — the crawler-filled drafts never rely on this path though).
func pgTextPtr(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

// nonNil turns a missing tag list into an empty array: the columns are NOT
// NULL and pgx encodes nil slices as SQL NULL.
func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
