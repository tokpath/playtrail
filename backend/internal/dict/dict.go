// Package dict manages the category and tag dictionaries (PRD 07): renames,
// sort order, tag creation and deactivation. Renaming a tag rebuilds the
// public read model of every published game that references it (§4.3).
package dict

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"playtrail/backend/internal/audit"
	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/db"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/validate"
)

type Service struct {
	Catalog *catalog.Service
}

func nameFieldErrors(names map[string]string, locales []string) error {
	fields := map[string]string{}
	if len(names) == 0 {
		fields["names"] = "required"
		return httpx.Validation(fields)
	}
	for l, n := range names {
		supported := false
		for _, sl := range locales {
			if sl == l {
				supported = true
				break
			}
		}
		if !supported {
			fields["names."+l] = "unsupported locale"
			continue
		}
		if err := validate.LenField("names."+l, n, 1, 100); err != nil {
			mergeField(fields, err)
		}
	}
	if len(fields) > 0 {
		return httpx.Validation(fields)
	}
	return nil
}

func mergeField(into map[string]string, err error) {
	if apiErr, ok := err.(*httpx.Error); ok {
		for k, v := range apiErr.FieldErrors {
			into[k] = v
		}
	}
}

// Category is the admin dictionary entry.
type Category struct {
	Slug      string            `json:"slug"`
	Names     map[string]string `json:"names"`
	SourceURL string            `json:"sourceUrl"`
	SortOrder int               `json:"sortOrder"`
}

func categoryOf(row sqlc.Category) Category {
	return Category{Slug: row.Slug, Names: parseNames(row.Names), SourceURL: row.SourceUrl, SortOrder: int(row.SortOrder)}
}

// Categories returns the full category dictionary.
func (s *Service) Categories(ctx context.Context) ([]Category, error) {
	rows, err := s.Catalog.Q.ListCategories(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Category, 0, len(rows))
	for _, r := range rows {
		out = append(out, categoryOf(r))
	}
	return out, nil
}

// CategoryPatchInput is the PATCH /admin/categories/{slug} body.
type CategoryPatchInput struct {
	Names     map[string]string `json:"names"`
	SortOrder *int              `json:"sortOrder"`
}

// PatchCategory updates names and/or sort order.
func (s *Service) PatchCategory(ctx context.Context, slug string, in CategoryPatchInput, adminID *uuid.UUID, locales []string) ([]Category, error) {
	var namesJSON []byte
	if in.Names != nil {
		if err := nameFieldErrors(in.Names, locales); err != nil {
			return nil, err
		}
		namesJSON, _ = json.Marshal(in.Names)
	}
	var sortOrder pgtype.Int4
	if in.SortOrder != nil {
		if *in.SortOrder < 0 {
			return nil, httpx.Validation(map[string]string{"sortOrder": "must be non-negative"})
		}
		sortOrder = pgtype.Int4{Int32: int32(*in.SortOrder), Valid: true}
	}
	var rows []sqlc.Category
	err := db.InTx(ctx, s.Catalog.Pool, func(q *sqlc.Queries) error {
		_, err := q.UpdateCategory(ctx, sqlc.UpdateCategoryParams{Slug: slug, Names: namesJSON, SortOrder: sortOrder})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.NotFound("unknown category")
			}
			return err
		}
		rows, err = q.ListCategories(ctx)
		if err != nil {
			return err
		}
		summary := map[string]any{"slug": slug}
		if in.Names != nil {
			summary["names"] = in.Names
		}
		if in.SortOrder != nil {
			summary["sortOrder"] = *in.SortOrder
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorAdmin(adminID), Action: "dict.category_update",
			ObjectType: "category", ObjectID: slug, Summary: jsonSummary(summary),
		})
	})
	if err != nil {
		return nil, err
	}
	s.Catalog.Notify("dict")
	out := make([]Category, 0, len(rows))
	for _, r := range rows {
		out = append(out, categoryOf(r))
	}
	return out, nil
}

// Tag is the admin tag dictionary entry.
type Tag struct {
	Slug      string            `json:"slug"`
	Names     map[string]string `json:"names"`
	Active    bool              `json:"active"`
	CreatedAt string            `json:"createdAt"`
}

func tagOf(row sqlc.Tag) Tag {
	return Tag{Slug: row.Slug, Names: parseNames(row.Names), Active: row.Active, CreatedAt: row.CreatedAt.Format("2006-01-02T15:04:05Z07:00")}
}

// Tags returns the full tag dictionary.
func (s *Service) Tags(ctx context.Context) ([]Tag, error) {
	rows, err := s.Catalog.Q.ListTags(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Tag, 0, len(rows))
	for _, r := range rows {
		out = append(out, tagOf(r))
	}
	return out, nil
}

// CreateTagInput is the POST /admin/tags body.
type CreateTagInput struct {
	Slug  string            `json:"slug"`
	Names map[string]string `json:"names"`
}

// CreateTag adds a dictionary tag.
func (s *Service) CreateTag(ctx context.Context, in CreateTagInput, adminID *uuid.UUID, locales []string) (*Tag, error) {
	fields := map[string]string{}
	if err := validate.SlugField("slug", in.Slug); err != nil {
		mergeField(fields, err)
	}
	if err := nameFieldErrors(in.Names, locales); err != nil {
		mergeField(fields, err)
	}
	if len(fields) > 0 {
		return nil, httpx.Validation(fields)
	}
	namesJSON, _ := json.Marshal(in.Names)
	var row sqlc.Tag
	err := db.InTx(ctx, s.Catalog.Pool, func(q *sqlc.Queries) error {
		var err error
		row, err = q.InsertTag(ctx, sqlc.InsertTagParams{Slug: in.Slug, Names: namesJSON})
		if err != nil && isUniqueViolation(err) {
			return httpx.Validation(map[string]string{"slug": "tag already exists"})
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorAdmin(adminID), Action: "dict.tag_create",
			ObjectType: "tag", ObjectID: in.Slug, Summary: jsonSummary(map[string]any{"names": in.Names}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.Catalog.Notify("dict")
	t := tagOf(row)
	return &t, nil
}

// TagPatchInput is the PATCH /admin/tags/{slug} body.
type TagPatchInput struct {
	Names  map[string]string `json:"names"`
	Active *bool             `json:"active"`
}

// PatchTag renames and/or deactivates a tag. Renames rebuild the public rows
// of games referencing it because search_text contains tag names (§4.3).
func (s *Service) PatchTag(ctx context.Context, slug string, in TagPatchInput, adminID *uuid.UUID, locales []string) (*Tag, error) {
	var namesJSON []byte
	if in.Names != nil {
		if err := nameFieldErrors(in.Names, locales); err != nil {
			return nil, err
		}
		namesJSON, _ = json.Marshal(in.Names)
	}
	var active pgtype.Bool
	if in.Active != nil {
		active = pgtype.Bool{Bool: *in.Active, Valid: true}
	}
	var row sqlc.Tag
	err := db.InTx(ctx, s.Catalog.Pool, func(q *sqlc.Queries) error {
		var err error
		row, err = q.UpdateTag(ctx, sqlc.UpdateTagParams{Slug: slug, Names: namesJSON, Active: active})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.NotFound("unknown tag")
			}
			return err
		}
		summary := map[string]any{"slug": slug}
		if in.Names != nil {
			summary["names"] = in.Names
		}
		if in.Active != nil {
			summary["active"] = *in.Active
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorAdmin(adminID), Action: "dict.tag_update",
			ObjectType: "tag", ObjectID: slug, Summary: jsonSummary(summary),
		})
	})
	if err != nil {
		return nil, err
	}
	if in.Names != nil {
		if err := s.Catalog.RebuildGamesUsingTag(ctx, slug); err != nil {
			return nil, err
		}
	}
	s.Catalog.Notify("dict")
	t := tagOf(row)
	return &t, nil
}

func parseNames(raw []byte) map[string]string {
	m := map[string]string{}
	_ = json.Unmarshal(raw, &m)
	return m
}

func actorAdmin(adminID *uuid.UUID) string {
	if adminID != nil {
		return adminID.String()
	}
	return "admin"
}

func jsonSummary(v any) []byte {
	raw, _ := json.Marshal(v)
	return raw
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
