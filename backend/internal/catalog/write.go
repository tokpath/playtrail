package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"playtrail/backend/internal/audit"
	"playtrail/backend/internal/db"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/media"
	"playtrail/backend/internal/validate"
)

// CreateInput is the POST /admin/games body (validated here, decoded in api).
type CreateInput struct {
	Name            string   `json:"name"`
	ExternalURL     string   `json:"externalUrl"`
	SourceURL       string   `json:"sourceUrl"`
	SourceFetchedAt string   `json:"sourceFetchedAt"`
	Slug            *string  `json:"slug"`
	PrimaryCategory *string  `json:"primaryCategory"`
	Tags            []string `json:"tags"`
}

// CreateGame creates the games row plus its first revision (draft) in one
// transaction (§4.1).
func (s *Service) CreateGame(ctx context.Context, in CreateInput, actor string, adminID *uuid.UUID) (*AdminGame, error) {
	fields := map[string]string{}
	if err := validate.LenField("name", in.Name, 1, 150); err != nil {
		mergeField(fields, err)
	}
	external, err := validate.NormalizeGameURL("externalUrl", in.ExternalURL)
	if err != nil {
		mergeField(fields, err)
	}
	source, err := validate.HTTPSField("sourceUrl", in.SourceURL)
	if err != nil {
		mergeField(fields, err)
	}
	fetchedAt, err := validate.TimeField("sourceFetchedAt", in.SourceFetchedAt, s.Clock.Now(), 0, false)
	if err != nil {
		mergeField(fields, err)
	}
	if in.Slug != nil && *in.Slug != "" {
		if err := validate.SlugField("slug", *in.Slug); err != nil {
			mergeField(fields, err)
		}
	}
	if in.PrimaryCategory != nil && *in.PrimaryCategory != "" {
		if _, err := s.Q.GetCategory(ctx, *in.PrimaryCategory); err != nil {
			fields["primaryCategory"] = "unknown category"
		}
	}
	if err := validateTagSlugs(ctx, s.Q, in.Tags); err != nil {
		mergeField(fields, err)
	}
	if len(fields) > 0 {
		return nil, httpx.Validation(fields)
	}

	slug := ""
	if in.Slug != nil {
		slug = *in.Slug
	} else {
		slug = validate.GameSlugFromName(in.Name)
	}

	var gameID uuid.UUID
	err = db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		var err error
		slug, err = s.uniqueSlug(ctx, q, slug)
		if err != nil {
			return err
		}
		if _, err := q.GetGameByExternalURL(ctx, external); err == nil {
			return httpx.Validation(map[string]string{"externalUrl": "a game with this URL already exists"})
		}
		game, err := q.InsertGame(ctx, sqlc.InsertGameParams{Slug: slug, ExternalUrl: external})
		if err != nil {
			return err
		}
		gameID = game.ID
		rev, err := q.InsertRevision(ctx, sqlc.InsertRevisionParams{
			GameID:             game.ID,
			Name:               in.Name,
			PrimaryCategory:    pgTextPtr(in.PrimaryCategory),
			Tags:               cleanTags(in.Tags),
			SourceUrl:          source,
			SourceFetchedAt:    fetchedAt,
			DeviceSupport:      "unknown",
			ScreenshotAssetIds: []uuid.UUID{},
			UsePlaceholder:     true,
			MaterialReview:     "placeholder",
			CreatedBy:          actor,
		})
		if err != nil {
			return err
		}
		if err := q.SetGameDraftRevision(ctx, sqlc.SetGameDraftRevisionParams{ID: game.ID, RevisionID: &rev.ID}); err != nil {
			return err
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf(actor, adminID), Action: "game.create",
			ObjectType: "game", ObjectID: game.ID.String(),
			Summary: jsonSummary(map[string]any{"slug": game.Slug, "name": in.Name}),
		})
	})
	if err != nil {
		return nil, err
	}
	// 22.5: a newly created game may already have a source row (seed, import,
	// manual create) — link by external URL so the crawler tracks it.
	if _, err := s.Q.LinkSourceGamesByExternalURL(ctx); err != nil {
		return nil, err
	}
	return s.AdminGame(ctx, gameID)
}

// uniqueSlug appends a short suffix when the slug is already taken (PRD 09).
func (s *Service) uniqueSlug(ctx context.Context, q *sqlc.Queries, slug string) (string, error) {
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
			return "", httpx.Validation(map[string]string{"slug": "could not derive a unique slug"})
		}
		suffix := uuid.NewString()[:6]
		if len(base)+1+len(suffix) > 100 {
			base = base[:100-1-len(suffix)]
		}
		slug = base + "-" + suffix
	}
}

func validateTagSlugs(ctx context.Context, q *sqlc.Queries, tags []string) error {
	fields := map[string]string{}
	if len(tags) > 8 {
		fields["tags"] = "at most 8 tags"
	}
	seen := map[string]bool{}
	for _, t := range tags {
		if seen[t] {
			fields["tags"] = "duplicate tag " + t
			break
		}
		seen[t] = true
		if _, err := q.GetTag(ctx, t); err != nil {
			fields["tags"] = "unknown tag " + t
			break
		}
	}
	if len(fields) > 0 {
		return httpx.Validation(fields)
	}
	return nil
}

// LocalePatch is one locale's patch body.
type LocalePatch struct {
	Alias             *string           `json:"alias"`
	Summary           *string           `json:"summary"`
	Description       *string           `json:"description"`
	Controls          *string           `json:"controls"`
	MediaAlt          map[string]string `json:"mediaAlt"`
	TranslationMethod *string           `json:"translationMethod"`
}

// ensureDraft returns the game's draft revision, copying the published one
// into a fresh draft when no draft is pending (§4.1).
func (s *Service) ensureDraft(ctx context.Context, q *sqlc.Queries, game sqlc.Game, actor string) (sqlc.GameRevision, error) {
	if game.DraftRevisionID != nil {
		return q.GetRevision(ctx, *game.DraftRevisionID)
	}
	if game.PublishedRevisionID == nil {
		return sqlc.GameRevision{}, httpx.Validation(map[string]string{"id": "game has no revision"})
	}
	rev, err := q.CopyRevision(ctx, sqlc.CopyRevisionParams{ID: *game.PublishedRevisionID, CreatedBy: actor})
	if err != nil {
		return sqlc.GameRevision{}, err
	}
	if err := q.CopyRevisionLocales(ctx, sqlc.CopyRevisionLocalesParams{ToRevision: rev.ID, FromRevision: *game.PublishedRevisionID}); err != nil {
		return sqlc.GameRevision{}, err
	}
	if err := q.SetGameDraftRevision(ctx, sqlc.SetGameDraftRevisionParams{ID: game.ID, RevisionID: &rev.ID}); err != nil {
		return sqlc.GameRevision{}, err
	}
	return rev, nil
}

// PatchInput is the PATCH /admin/games/{id} body (§6.3).
type PatchInput struct {
	RevisionVersion   int      `json:"revisionVersion"`
	Slug              *string  `json:"slug"`
	ExternalURL       *string  `json:"externalUrl"`
	Name              *string  `json:"name"`
	Developer         *string  `json:"developer"`
	PrimaryCategory   *string  `json:"primaryCategory"`
	Tags              []string `json:"tags"`
	DeviceSupport     *string  `json:"deviceSupport"`
	DeviceEvidenceURL *string  `json:"deviceEvidenceUrl"`
	DeviceCheckedAt   *string  `json:"deviceCheckedAt"`
	SourceURL         *string  `json:"sourceUrl"`
	SourceFetchedAt   *string  `json:"sourceFetchedAt"`
	// CoverAssetID is **string so an explicit JSON null (cleared cover) can
	// be distinguished from an absent field.
	CoverAssetID       **string               `json:"coverAssetId"`
	CoverSourcePath    *string                `json:"coverSourcePath"`
	ScreenshotAssetIDs []string               `json:"screenshotAssetIds"`
	UsePlaceholder     *bool                  `json:"usePlaceholder"`
	MaterialReview     *string                `json:"materialReview"`
	Featured           *bool                  `json:"featured"`
	EditorialOrder     *int                   `json:"editorialOrder"`
	Locales            map[string]LocalePatch `json:"locales"`
}

// PatchGame applies §4.1: copy the published revision into a fresh draft when
// needed, apply validated changes, reset per-locale content review, bump the
// revision version. Public state is untouched.
func (s *Service) PatchGame(ctx context.Context, gameID uuid.UUID, in PatchInput, adminID *uuid.UUID) (*AdminGame, error) {
	var changed []string
	err := db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		game, err := q.GetGameForUpdate(ctx, gameID)
		if err != nil {
			return gameErr(err)
		}
		if int(game.RevisionVersion) != in.RevisionVersion {
			return httpx.RevisionConflict()
		}

		fields := map[string]string{}
		now := s.Clock.Now()

		// Identity fields are locked after first publish (§4.1).
		identityChanged := false
		if in.Slug != nil || in.ExternalURL != nil {
			if game.FirstPublishedAt != nil {
				if in.Slug != nil {
					fields["slug"] = "cannot be changed after first publish"
				}
				if in.ExternalURL != nil {
					fields["externalUrl"] = "cannot be changed after first publish"
				}
			} else {
				identityChanged = true
			}
		}

		// Material changes recompute material_review; an explicit
		// materialReview only applies when assets did not change. The
		// CrazyGames cover path is not an asset (PRD 22.12).
		assetsChanged := in.CoverAssetID != nil || in.ScreenshotAssetIDs != nil || in.UsePlaceholder != nil

		// §4.1: when no draft is pending, copy the published revision (with
		// all locale rows) as the new draft before modifying it.
		rev, err := s.ensureDraft(ctx, q, game, actorOf("admin", adminID))
		if err != nil {
			return err
		}

		var (
			name      = optText(in.Name, rev.Name)
			developer = optText(in.Developer, rev.Developer)
			// Category is nullable: an absent patch field must keep the
			// existing value (NULL stays NULL — a '' would violate the FK).
			primaryCategory = pgtype.Text{}
			tags            = rev.Tags
			deviceSupport   = rev.DeviceSupport
			deviceEvidence  = rev.DeviceEvidenceUrl
			deviceChecked   = rev.DeviceCheckedAt
			sourceURL       = rev.SourceUrl
			sourceFetched   = rev.SourceFetchedAt
			coverAsset      = rev.CoverAssetID
			coverSourcePath = rev.CoverSourcePath
			screenshots     = rev.ScreenshotAssetIds
			usePlaceholder  = rev.UsePlaceholder
			materialReview  = rev.MaterialReview
		)

		if in.Name != nil && !validLen(fields, "name", *in.Name, 1, 150) {
			name = *in.Name
		}
		if in.Developer != nil && !validLen(fields, "developer", *in.Developer, 0, 150) {
			developer = *in.Developer
		}
		if in.PrimaryCategory != nil {
			if _, err := q.GetCategory(ctx, *in.PrimaryCategory); err != nil {
				fields["primaryCategory"] = "unknown category"
			} else {
				primaryCategory = pgText(*in.PrimaryCategory)
			}
		}
		if in.Tags != nil {
			if err := validateTagSlugs(ctx, q, in.Tags); err != nil {
				mergeField(fields, err)
			} else {
				tags = cleanTags(in.Tags)
			}
		}
		if in.DeviceSupport != nil {
			if err := validate.EnumField("deviceSupport", *in.DeviceSupport, "unknown", "desktop", "mobile", "both"); err != nil {
				mergeField(fields, err)
			} else {
				deviceSupport = *in.DeviceSupport
			}
		}
		if in.DeviceEvidenceURL != nil && *in.DeviceEvidenceURL != "" {
			v, err := validate.HTTPSField("deviceEvidenceUrl", *in.DeviceEvidenceURL)
			if err != nil {
				mergeField(fields, err)
			} else {
				deviceEvidence = v
			}
		}
		if in.DeviceCheckedAt != nil {
			t, err := validate.OptionalTimeField("deviceCheckedAt", in.DeviceCheckedAt, now)
			if err != nil {
				mergeField(fields, err)
			} else {
				deviceChecked = t
			}
		}
		if in.SourceURL != nil {
			v, err := validate.HTTPSField("sourceUrl", *in.SourceURL)
			if err != nil {
				mergeField(fields, err)
			} else {
				sourceURL = v
			}
		}
		if in.SourceFetchedAt != nil {
			t, err := validate.TimeField("sourceFetchedAt", *in.SourceFetchedAt, now, 0, false)
			if err != nil {
				mergeField(fields, err)
			} else {
				sourceFetched = t
			}
		}
		clearCover := false
		if in.CoverAssetID != nil {
			if *in.CoverAssetID == nil {
				clearCover = true
				coverAsset = nil
			} else {
				id, err := uuid.Parse(**in.CoverAssetID)
				if err != nil {
					fields["coverAssetId"] = "must be a UUID"
				} else if _, err := q.GetMediaAsset(ctx, id); err != nil {
					fields["coverAssetId"] = "unknown asset"
				} else {
					coverAsset = &id
				}
			}
		}
		if in.CoverSourcePath != nil {
			v, err := validate.CoverSourcePathField("coverSourcePath", *in.CoverSourcePath)
			if err != nil {
				mergeField(fields, err)
			} else {
				coverSourcePath = v
			}
		}
		if in.ScreenshotAssetIDs != nil {
			if len(in.ScreenshotAssetIDs) > 5 {
				fields["screenshotAssetIds"] = "at most 5 screenshots"
			} else if ids, ok := uuidsText(in.ScreenshotAssetIDs); !ok {
				fields["screenshotAssetIds"] = "must be UUIDs"
			} else {
				for _, id := range ids {
					if _, err := q.GetMediaAsset(ctx, id); err != nil {
						fields["screenshotAssetIds"] = "unknown asset " + id.String()
						break
					}
				}
				screenshots = ids
			}
		}
		if in.UsePlaceholder != nil {
			usePlaceholder = *in.UsePlaceholder
		}
		if in.MaterialReview != nil {
			if err := validate.EnumField("materialReview", *in.MaterialReview, "placeholder", "pending", "approved", "rejected"); err != nil {
				mergeField(fields, err)
			} else {
				materialReview = *in.MaterialReview
			}
		}
		if assetsChanged {
			// §4.1: recompute — placeholder only when explicitly chosen and
			// no real assets are referenced.
			noAssets := coverAsset == nil && len(screenshots) == 0
			if usePlaceholder && noAssets {
				materialReview = "placeholder"
			} else if materialReview == "placeholder" && !noAssets {
				materialReview = "pending"
			}
		}
		if len(fields) > 0 {
			return httpx.Validation(fields)
		}

		updated, err := q.UpdateRevision(ctx, sqlc.UpdateRevisionParams{
			Name:               pgText(name),
			Developer:          pgText(developer),
			PrimaryCategory:    primaryCategory,
			Tags:               tags,
			DeviceSupport:      pgText(deviceSupport),
			DeviceEvidenceUrl:  pgText(deviceEvidence),
			DeviceCheckedAt:    deviceChecked,
			SourceUrl:          pgText(sourceURL),
			SourceFetchedAt:    &sourceFetched,
			CoverAssetID:       coverAsset,
			CoverSourcePath:    pgText(coverSourcePath),
			ScreenshotAssetIds: screenshots,
			UsePlaceholder:     pgBool(usePlaceholder),
			MaterialReview:     pgText(materialReview),
			ID:                 rev.ID,
		})
		if err != nil {
			return err
		}
		if clearCover {
			if err := q.ClearRevisionCover(ctx, rev.ID); err != nil {
				return err
			}
			updated.CoverAssetID = nil
		}
		rev = updated

		// Locale content.
		for locale, lp := range in.Locales {
			if !s.IsSupported(locale) {
				fields["locales."+locale] = "unsupported locale"
				continue
			}
			if err := s.patchLocale(ctx, q, rev, locale, lp); err != nil {
				return err
			}
			changed = append(changed, "locale:"+locale)
		}
		if len(fields) > 0 {
			return httpx.Validation(fields)
		}

		if identityChanged {
			slug := revSlug(in.Slug, game.Slug)
			external := game.ExternalUrl
			if in.ExternalURL != nil {
				norm, err := validate.NormalizeGameURL("externalUrl", *in.ExternalURL)
				if err != nil {
					return err
				}
				external = norm
			}
			if err := validate.SlugField("slug", slug); err != nil {
				return err
			}
			slug, err = s.uniqueSlug(ctx, q, slug)
			if err != nil {
				return err
			}
			if other, err := q.GetGameByExternalURL(ctx, external); err == nil && other.ID != game.ID {
				return httpx.Validation(map[string]string{"externalUrl": "a game with this URL already exists"})
			}
			if err := q.SetGameIdentity(ctx, sqlc.SetGameIdentityParams{ID: game.ID, Slug: slug, ExternalUrl: external}); err != nil {
				return err
			}
			changed = append(changed, "identity")
		}
		if in.Featured != nil || in.EditorialOrder != nil {
			var feat pgtype.Bool
			if in.Featured != nil {
				feat = pgBool(*in.Featured)
			}
			order := pgtype.Int4{}
			if in.EditorialOrder != nil {
				if *in.EditorialOrder < 0 {
					return httpx.Validation(map[string]string{"editorialOrder": "must be non-negative"})
				}
				order = pgIntPtr(*in.EditorialOrder)
			}
			if err := q.SetGameOps(ctx, sqlc.SetGameOpsParams{
				ID: game.ID, Featured: feat, EditorialOrder: order,
			}); err != nil {
				return err
			}
			changed = append(changed, "ops")
		}

		if _, err := q.BumpRevisionVersion(ctx, game.ID); err != nil {
			return err
		}
		changed = append(changed, "revision")
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf("admin", adminID), Action: "game.patch",
			ObjectType: "game", ObjectID: game.ID.String(),
			Summary: jsonSummary(map[string]any{"changed": changed, "revisionVersion": in.RevisionVersion + 1}),
		})
	})
	if err != nil {
		return nil, err
	}
	return s.AdminGame(ctx, gameID)
}

// patchLocale upserts one locale row on the draft revision, resetting
// content_review to pending when content fields changed (§4.1).
func (s *Service) patchLocale(ctx context.Context, q *sqlc.Queries, rev sqlc.GameRevision, locale string, lp LocalePatch) error {
	existing, err := q.GetRevisionLocale(ctx, sqlc.GetRevisionLocaleParams{RevisionID: rev.ID, Locale: locale})
	notFound := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !notFound {
		return err
	}
	row := existing
	if notFound {
		row = sqlc.GameRevisionLocale{Locale: locale, TranslationMethod: "original", ContentReview: "pending", MediaAlt: []byte("{}")}
	}

	limits := LimitsFor(locale)
	fields := map[string]string{}
	if lp.Alias != nil {
		if err := validate.LenField("alias", *lp.Alias, 0, limits.AliasMax); err != nil {
			mergeField(fields, err)
		}
		row.Alias = *lp.Alias
	}
	if lp.Summary != nil {
		if err := validate.LenField("summary", *lp.Summary, 0, limits.SummaryMax); err != nil {
			mergeField(fields, err)
		}
		row.Summary = *lp.Summary
	}
	if lp.Description != nil {
		if err := validate.LenField("description", *lp.Description, 0, limits.DescMax); err != nil {
			mergeField(fields, err)
		}
		row.Description = *lp.Description
	}
	if lp.Controls != nil {
		if err := validate.LenField("controls", *lp.Controls, 0, limits.ControlsMax); err != nil {
			mergeField(fields, err)
		}
		row.Controls = *lp.Controls
	}
	if lp.MediaAlt != nil {
		alt := map[string]string{}
		for assetID, text := range lp.MediaAlt {
			if _, err := uuid.Parse(assetID); err != nil {
				fields["mediaAlt"] = "keys must be asset UUIDs"
				continue
			}
			if err := validate.LenField("mediaAlt", text, 1, 150); err != nil {
				mergeField(fields, err)
			}
			alt[assetID] = text
		}
		raw, _ := json.Marshal(alt)
		row.MediaAlt = raw
	}
	if lp.TranslationMethod != nil {
		if err := validate.EnumField("translationMethod", *lp.TranslationMethod, "original", "human_translated", "machine_assisted"); err != nil {
			mergeField(fields, err)
		} else {
			row.TranslationMethod = *lp.TranslationMethod
		}
	}
	if len(fields) > 0 {
		return httpx.Validation(fields)
	}

	// Content edits reset this locale's review state (§4.1).
	if lp.Alias != nil || lp.Summary != nil || lp.Description != nil || lp.Controls != nil || lp.MediaAlt != nil {
		row.ContentReview = "pending"
		row.ReviewedAt = nil
		row.ReviewedBy = nil
	}

	_, err = q.UpsertRevisionLocale(ctx, sqlc.UpsertRevisionLocaleParams{
		RevisionID:        rev.ID,
		Locale:            locale,
		Alias:             row.Alias,
		Summary:           row.Summary,
		Description:       row.Description,
		Controls:          row.Controls,
		MediaAlt:          row.MediaAlt,
		ContentReview:     row.ContentReview,
		TranslationMethod: row.TranslationMethod,
		ReviewedAt:        row.ReviewedAt,
		ReviewedBy:        row.ReviewedBy,
	})
	return err
}

// ReviewInput is the per-locale review body.
type ReviewInput struct {
	RevisionVersion      int    `json:"revisionVersion"`
	Decision             string `json:"decision"`
	ConfirmOriginal      bool   `json:"confirmOriginal"`
	ConfirmFactsVerified bool   `json:"confirmFactsVerified"`
}

// ReviewLocale records an approved/rejected content review for one locale.
func (s *Service) ReviewLocale(ctx context.Context, gameID uuid.UUID, locale string, in ReviewInput, adminID *uuid.UUID) (*AdminGame, error) {
	if !s.IsSupported(locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	fields := map[string]string{}
	if err := validate.EnumField("decision", in.Decision, "approved", "rejected"); err != nil {
		mergeField(fields, err)
	}
	if !in.ConfirmOriginal {
		fields["confirmOriginal"] = "must be confirmed"
	}
	if !in.ConfirmFactsVerified {
		fields["confirmFactsVerified"] = "must be confirmed"
	}
	if len(fields) > 0 {
		return nil, httpx.Validation(fields)
	}

	err := db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		game, err := q.GetGameForUpdate(ctx, gameID)
		if err != nil {
			return gameErr(err)
		}
		if int(game.RevisionVersion) != in.RevisionVersion {
			return httpx.RevisionConflict()
		}
		rev, err := candidateRevisionFor(ctx, q, game)
		if err != nil {
			return err
		}
		if _, err := q.GetRevisionLocale(ctx, sqlc.GetRevisionLocaleParams{RevisionID: rev.ID, Locale: locale}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.Validation(map[string]string{"locale": "no content for this locale"})
			}
			return err
		}
		now := s.Clock.Now()
		if err := q.SetRevisionLocaleReview(ctx, sqlc.SetRevisionLocaleReviewParams{
			RevisionID: rev.ID, Locale: locale, Decision: in.Decision, ReviewedAt: &now, ReviewedBy: adminID,
		}); err != nil {
			return err
		}
		if _, err := q.BumpRevisionVersion(ctx, game.ID); err != nil {
			return err
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf("admin", adminID), Action: "game.review_locale",
			ObjectType: "game", ObjectID: game.ID.String(),
			Summary: jsonSummary(map[string]any{"locale": locale, "decision": in.Decision}),
		})
	})
	if err != nil {
		return nil, err
	}
	return s.AdminGame(ctx, gameID)
}

// LinkCheckInput is the manual link check body.
type LinkCheckInput struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

// LinkCheck records a manual link check; it changes outbound_allowed, so the
// public rows of a published game are rebuilt in the same transaction.
func (s *Service) LinkCheck(ctx context.Context, gameID uuid.UUID, in LinkCheckInput, adminID *uuid.UUID) (*AdminGame, error) {
	if err := validate.EnumField("status", in.Status, "valid", "suspect", "invalid"); err != nil {
		return nil, err
	}
	if err := validate.LenField("note", in.Note, 0, 500); err != nil {
		return nil, err
	}
	var slug string
	err := db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		game, err := q.GetGameForUpdate(ctx, gameID)
		if err != nil {
			return gameErr(err)
		}
		slug = game.Slug
		if err := q.SetGameLinkCheck(ctx, sqlc.SetGameLinkCheckParams{
			ID: game.ID, Status: in.Status, CheckedAt: nowPtr(s.Clock.Now()), Note: in.Note,
		}); err != nil {
			return err
		}
		if game.Status == "published" {
			if err := s.RebuildPublicGameTx(ctx, q, game.ID); err != nil {
				return err
			}
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf("admin", adminID), Action: "game.link_check",
			ObjectType: "game", ObjectID: game.ID.String(),
			Summary: jsonSummary(map[string]any{"status": in.Status}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.notify("games", "game:"+slug)
	return s.AdminGame(ctx, gameID)
}

// UnlistInput is the unlist body; the reason is mandatory (PRD 07).
type UnlistInput struct {
	Reason string `json:"reason"`
}

// Unlist removes a published game from the public read model.
func (s *Service) Unlist(ctx context.Context, gameID uuid.UUID, in UnlistInput, adminID *uuid.UUID) (*AdminGame, error) {
	if err := validate.LenField("reason", in.Reason, 1, 500); err != nil {
		return nil, err
	}
	var slug string
	err := db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		game, err := q.GetGameForUpdate(ctx, gameID)
		if err != nil {
			return gameErr(err)
		}
		slug = game.Slug
		if game.Status != "published" {
			return httpx.Validation(map[string]string{"status": "only published games can be unlisted"})
		}
		if err := q.SetGameStatus(ctx, sqlc.SetGameStatusParams{ID: game.ID, Status: "unlisted", Reason: in.Reason}); err != nil {
			return err
		}
		if err := q.DeletePublicGameRows(ctx, game.ID); err != nil {
			return err
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf("admin", adminID), Action: "game.unlist",
			ObjectType: "game", ObjectID: game.ID.String(),
			Summary: jsonSummary(map[string]any{"reason": in.Reason}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.notify("games", "game:"+slug)
	return s.AdminGame(ctx, gameID)
}

// OutboundInput is the CTA toggle body.
type OutboundInput struct {
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason"`
}

// SetOutbound toggles the outbound CTA (immediate effect, PRD 07).
func (s *Service) SetOutbound(ctx context.Context, gameID uuid.UUID, in OutboundInput, adminID *uuid.UUID) (*AdminGame, error) {
	if err := validate.LenField("reason", in.Reason, 0, 500); err != nil {
		return nil, err
	}
	var slug string
	err := db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		game, err := q.GetGameForUpdate(ctx, gameID)
		if err != nil {
			return gameErr(err)
		}
		slug = game.Slug
		if err := q.SetGameOutbound(ctx, sqlc.SetGameOutboundParams{
			ID: game.ID, Disabled: !in.Enabled, Reason: in.Reason,
		}); err != nil {
			return err
		}
		if game.Status == "published" {
			if err := s.RebuildPublicGameTx(ctx, q, game.ID); err != nil {
				return err
			}
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf("admin", adminID), Action: "game.outbound",
			ObjectType: "game", ObjectID: game.ID.String(),
			Summary: jsonSummary(map[string]any{"enabled": in.Enabled}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.notify("games", "game:"+slug)
	return s.AdminGame(ctx, gameID)
}

// PublishInput is the publish body.
type PublishInput struct {
	RevisionVersion int      `json:"revisionVersion"`
	Locales         []string `json:"locales"`
}

// Publish implements §4.2: evaluate gates, publish every requested locale
// that passes, rebuild the read model, bump the version. When no locale
// passes nothing is modified and a 422 PUBLISH_GATE_FAILED is returned.
func (s *Service) Publish(ctx context.Context, gameID uuid.UUID, in PublishInput, adminID *uuid.UUID) (*AdminGame, error) {
	var slug string
	err := db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		game, err := q.GetGameForUpdate(ctx, gameID)
		if err != nil {
			return gameErr(err)
		}
		slug = game.Slug
		if int(game.RevisionVersion) != in.RevisionVersion {
			return httpx.RevisionConflict()
		}

		for _, l := range in.Locales {
			if !s.IsSupported(l) {
				return httpx.InvalidParam("unsupported locale: " + l)
			}
		}

		rev, err := candidateRevisionFor(ctx, q, game)
		if err != nil {
			return err
		}

		requested := in.Locales
		if len(requested) == 0 {
			// Default: all supported locales (only those passing publish).
			requested = append(requested, s.Locales...)
		}
		report, err := s.computeGates(ctx, q, game, rev, requested)
		if err != nil {
			return err
		}

		var passed []string
		for _, l := range requested {
			if report.Game.OK && report.Locales[l].OK {
				passed = append(passed, l)
			}
		}
		if len(passed) == 0 {
			return &httpx.Error{
				Status:      422,
				Code:        httpx.CodePublishGateFailed,
				Message:     "Publish gates not satisfied",
				FieldErrors: gateFieldErrors(report, requested),
			}
		}

		now := s.Clock.Now()
		updated, err := q.PublishGame(ctx, sqlc.PublishGameParams{ID: game.ID, RevisionID: &rev.ID, Now: &now})
		if err != nil {
			return err
		}
		for _, l := range passed {
			if err := q.UpsertLocaleState(ctx, sqlc.UpsertLocaleStateParams{
				GameID: game.ID, Locale: l, LiveRevisionID: rev.ID, Now: now,
			}); err != nil {
				return err
			}
		}
		if err := s.RebuildPublicGameTx(ctx, q, updated.ID); err != nil {
			return err
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf("admin", adminID), Action: "game.publish",
			ObjectType: "game", ObjectID: game.ID.String(),
			Summary: jsonSummary(map[string]any{"locales": passed, "revisionId": rev.ID.String()}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.notify("games", "game:"+slug)
	return s.AdminGame(ctx, gameID)
}

// gateFieldErrors flattens a gate report into the unified fieldErrors map.
func gateFieldErrors(report GateReport, requested []string) map[string]string {
	out := map[string]string{}
	for _, f := range report.Game.Failures {
		out[f.Field] = f.Message
	}
	for _, l := range requested {
		for _, f := range report.Locales[l].Failures {
			out[f.Field] = f.Message
		}
	}
	return out
}

// ErrPublicRebuildSkip is returned when a live revision has lost its locale
// row and the rebuild skips that locale; rebuild-public treats it as no-op.
var ErrPublicRebuildSkip = errors.New("skip")

// RebuildPublicGameTx rewrites this game's public_games rows from the
// published revision and live locale states (§4.3). Must run inside the
// caller's transaction.
func (s *Service) RebuildPublicGameTx(ctx context.Context, q *sqlc.Queries, gameID uuid.UUID) error {
	if err := q.DeletePublicGameRows(ctx, gameID); err != nil {
		return err
	}
	game, err := q.GetGame(ctx, gameID)
	if err != nil {
		return err
	}
	if game.Status != "published" || game.PublishedRevisionID == nil {
		return nil
	}
	rev, err := q.GetRevision(ctx, *game.PublishedRevisionID)
	if err != nil {
		return err
	}
	var category *sqlc.Category
	if rev.PrimaryCategory.Valid {
		row, err := q.GetCategory(ctx, rev.PrimaryCategory.String)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("published revision references unknown category %q", rev.PrimaryCategory.String)
			}
			return err
		}
		category = &row
	}
	var tagRows []sqlc.Tag
	if len(rev.Tags) > 0 {
		tagRows, err = q.ListTagsBySlugs(ctx, rev.Tags)
		if err != nil {
			return err
		}
	}
	tagName := func(slug, locale string) string {
		for _, t := range tagRows {
			if t.Slug == slug {
				return parseNames(t.Names)[locale]
			}
		}
		return slug
	}
	assets, err := s.loadAssets(ctx, q, rev)
	if err != nil {
		return err
	}
	outbound := game.LinkStatus == "valid" && !game.OutboundDisabled

	states, err := q.ListLocaleStates(ctx, game.ID)
	if err != nil {
		return err
	}
	for _, st := range states {
		cl, err := q.GetRevisionLocale(ctx, sqlc.GetRevisionLocaleParams{RevisionID: st.LiveRevisionID, Locale: st.Locale})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue // live revision lost its locale row; skip rather than corrupt the model
			}
			return err
		}
		alt := parseNames(cl.MediaAlt)

		coverImg := s.buildCover(rev, assets, coverAlt(rev, cl))
		var cover []byte
		if coverImg != nil {
			cover, _ = json.Marshal(coverImg)
		}
		screenshots := []media.Image{}
		for _, id := range rev.ScreenshotAssetIds {
			if a, ok := assets[id]; ok {
				if img := s.Media.PublicImage(a, alt[id.String()]); img != nil {
					screenshots = append(screenshots, *img)
				}
			}
		}
		screenshotsJSON, _ := json.Marshal(screenshots)

		var tagNames []string
		for _, slug := range rev.Tags {
			tagNames = append(tagNames, tagName(slug, st.Locale))
		}
		search := strings.ToLower(strings.Join([]string{rev.Name, cl.Alias, cl.Summary, cl.Description, strings.Join(tagNames, " ")}, " "))

		primary := ""
		if category != nil {
			primary = category.Slug
		}
		if err := q.InsertPublicGame(ctx, sqlc.InsertPublicGameParams{
			GameID: game.ID, Locale: st.Locale, Slug: game.Slug,
			Name: rev.Name, Alias: cl.Alias, Summary: cl.Summary,
			Description: cl.Description, Controls: cl.Controls,
			PrimaryCategory: primary, Tags: rev.Tags,
			Developer: rev.Developer, DeviceSupport: rev.DeviceSupport,
			DeviceEvidenceUrl: rev.DeviceEvidenceUrl, DeviceCheckedAt: rev.DeviceCheckedAt,
			SourceUrl: rev.SourceUrl, SourceFetchedAt: rev.SourceFetchedAt,
			Cover: cover, Screenshots: screenshotsJSON,
			ExternalUrl: game.ExternalUrl, OutboundAllowed: outbound,
			Featured: game.Featured, EditorialOrder: game.EditorialOrder,
			FirstPublishedAt: st.FirstPublishedAt, PublishedAt: st.PublishedAt,
			SearchText: search,
		}); err != nil {
			return err
		}
	}
	return nil
}

// RebuildGamesUsingTag re-publishes the read model of every published game
// whose revision references the tag (called after tag renames, §4.3).
func (s *Service) RebuildGamesUsingTag(ctx context.Context, tagSlug string) error {
	ids, err := s.Q.ListGameIDsByPublishedTag(ctx, []string{tagSlug})
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
			return s.RebuildPublicGameTx(ctx, q, id)
		}); err != nil {
			return err
		}
	}
	if len(ids) > 0 {
		s.notify("games")
	}
	return nil
}

// ---- small helpers ----

// notify calls the revalidation hook when one is configured (seed/worker
// run without a notifier).
func (s *Service) notify(tags ...string) {
	if s.Notify != nil {
		s.Notify(tags...)
	}
}

func mergeField(into map[string]string, err error) {
	if apiErr, ok := err.(*httpx.Error); ok {
		for k, v := range apiErr.FieldErrors {
			into[k] = v
		}
	}
}

func validLen(fields map[string]string, field, s string, min, max int) bool {
	if err := validate.LenField(field, s, min, max); err != nil {
		mergeField(fields, err)
		return false
	}
	return true
}

func optText(provided *string, current string) string {
	if provided != nil {
		return *provided
	}
	return current
}

func revSlug(provided *string, current string) string {
	if provided != nil && *provided != "" {
		return *provided
	}
	return current
}

func cleanTags(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}

func gameErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("game not found")
	}
	return err
}

func actorOf(actor string, adminID *uuid.UUID) string {
	if actor == "admin" && adminID != nil {
		return adminID.String()
	}
	return actor
}

// altOrGameName picks the public cover alt text: the locale alias when set,
// otherwise the game name (§4.3).
// coverAlt picks the public cover alt text: the locale alias when set,
// otherwise the game name (§4.3).
func coverAlt(rev sqlc.GameRevision, cl sqlc.GameRevisionLocale) string {
	if alias := strings.TrimSpace(cl.Alias); alias != "" {
		return alias
	}
	return rev.Name
}

func jsonSummary(v any) []byte {
	raw, _ := json.Marshal(v)
	return raw
}

func pgText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: true} }

func pgTextPtr(s *string) pgtype.Text {
	if s == nil || *s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func pgBool(b bool) pgtype.Bool { return pgtype.Bool{Bool: b, Valid: true} }

func pgIntPtr(n int) pgtype.Int4 { return pgtype.Int4{Int32: int32(n), Valid: true} }

func nowPtr(t time.Time) *time.Time { return &t }
