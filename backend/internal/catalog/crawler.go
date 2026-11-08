package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"playtrail/backend/internal/audit"
	"playtrail/backend/internal/crawler"
	"playtrail/backend/internal/db"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/validate"
)

// CollectSourceGame creates a draft from a source-catalog entry, prefilled
// per PRD 22.6: name, developer, primary category (only from our dictionary),
// tags via tag_mappings, device suggestion with evidence, coverSourcePath.
// Content and reviews stay empty/pending.
func (s *Service) CollectSourceGame(ctx context.Context, sourceID uuid.UUID, adminID *uuid.UUID) (*AdminGame, error) {
	sg, err := s.Q.GetSourceGame(ctx, sourceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("unknown source game")
		}
		return nil, err
	}
	if sg.GameID != nil {
		return nil, httpx.New(http.StatusConflict, httpx.CodeValidationFailed, "source game already collected")
	}
	if sg.ParserVersion == 0 || sg.Name == "" || sg.LastFetchedAt == nil {
		return nil, httpx.Validation(map[string]string{"id": "collect requires a successful detail fetch"})
	}
	if !validate.SlugOK(sg.Slug) {
		return nil, httpx.Validation(map[string]string{"slug": "source slug is not a valid site slug"})
	}

	external := crawler.CanonicalURL(sg.Slug)
	tags, err := s.mappedTags(ctx, sg)
	if err != nil {
		return nil, err
	}
	device := suggestDevice(sg.DeviceFlags, external)
	var category *string
	if sg.CategorySlug != "" {
		if _, err := s.Q.GetCategory(ctx, sg.CategorySlug); err == nil {
			category = &sg.CategorySlug
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}

	var gameID uuid.UUID
	err = db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		if _, err := q.GetGameByExternalURL(ctx, external); err == nil {
			return httpx.Validation(map[string]string{"externalUrl": "a game with this URL already exists"})
		}
		slug, err := s.uniqueSlug(ctx, q, sg.Slug)
		if err != nil {
			return err
		}
		game, err := q.InsertGame(ctx, sqlc.InsertGameParams{Slug: slug, ExternalUrl: external})
		if err != nil {
			return err
		}
		gameID = game.ID
		rev, err := q.InsertRevision(ctx, sqlc.InsertRevisionParams{
			GameID: game.ID, Name: sg.Name,
			PrimaryCategory:    pgTextPtr(category),
			Developer:          sg.Developer,
			Tags:               tags,
			DeviceSupport:      device.support,
			DeviceEvidenceUrl:  device.evidenceURL,
			DeviceCheckedAt:    sg.LastFetchedAt,
			SourceUrl:          external,
			SourceFetchedAt:    *sg.LastFetchedAt,
			CoverSourcePath:    sg.CoverPath,
			ScreenshotAssetIds: []uuid.UUID{},
			UsePlaceholder:     true,
			MaterialReview:     "placeholder",
			CreatedBy:          "crawler",
		})
		if err != nil {
			return err
		}
		if err := q.SetGameDraftRevision(ctx, sqlc.SetGameDraftRevisionParams{ID: game.ID, RevisionID: &rev.ID}); err != nil {
			return err
		}
		if err := q.SetSourceGameCollected(ctx, sqlc.SetSourceGameCollectedParams{ID: sg.ID, GameID: &game.ID}); err != nil {
			return err
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf("crawler", nil), Action: "source.collect",
			ObjectType: "game", ObjectID: game.ID.String(),
			Summary: jsonSummary(map[string]any{"sourceSlug": sg.Slug, "tags": tags, "deviceSupport": device.support}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.Notify("games")
	return s.AdminGame(ctx, gameID)
}

// mappedTags maps CG tag slugs (plus the multiplayer flag) through
// tag_mappings; unmapped tags are ignored (PRD 22.6).
func (s *Service) mappedTags(ctx context.Context, sg sqlc.SourceGame) ([]string, error) {
	var sourceSlugs []string
	_ = json.Unmarshal(sg.Tags, &sourceSlugs)
	if sg.IsMultiplayer.Valid && sg.IsMultiplayer.Bool {
		sourceSlugs = append(sourceSlugs, "multiplayer")
	}
	if len(sourceSlugs) == 0 {
		return []string{}, nil
	}
	mappings, err := s.Q.ListTagMappingsBySourceSlugs(ctx, sourceSlugs)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	out := []string{}
	for _, m := range mappings {
		if m.TagSlug.Valid && !seen[m.TagSlug.String] {
			seen[m.TagSlug.String] = true
			out = append(out, m.TagSlug.String)
		}
	}
	return out, nil
}

type deviceSuggestion struct {
	support     string
	evidenceURL string
}

// deviceSuggestion derives the 22.6 device prefill from the CG platform
// flags; the evidence is the game page itself, checked at the last fetch.
func suggestDevice(rawFlags []byte, pageURL string) deviceSuggestion {
	var flags map[string]bool
	_ = json.Unmarshal(rawFlags, &flags)
	ios, android := flags["ios"], flags["android"]
	support := "desktop"
	switch {
	case ios && android:
		support = "both"
	case ios || android:
		support = "mobile"
	}
	return deviceSuggestion{support: support, evidenceURL: pageURL}
}

// ApplySourceChange resolves a detected source change (PRD 22.7 row 4):
// accept writes the new value into a fresh draft revision (the published
// content is never auto-edited), ignore just marks it resolved.
func (s *Service) ApplySourceChange(ctx context.Context, changeID uuid.UUID, action string, revisionVersion *int, adminID *uuid.UUID) (*AdminGame, error) {
	if err := validate.EnumField("action", action, "accept", "ignore"); err != nil {
		return nil, err
	}
	change, err := s.Q.GetSourceChange(ctx, changeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("unknown source change")
		}
		return nil, err
	}
	if change.State != "pending" {
		return nil, httpx.New(http.StatusConflict, httpx.CodeValidationFailed, "change already resolved")
	}

	if action == "ignore" {
		err = db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
			if err := q.ResolveSourceChange(ctx, sqlc.ResolveSourceChangeParams{
				ID: changeID, State: "ignored", ResolvedAt: nowPtr(s.Clock.Now()), ResolvedBy: adminID,
			}); err != nil {
				return err
			}
			return audit.Add(ctx, q, audit.Entry{
				AdminID: adminID, Actor: actorOf("admin", adminID), Action: "source.change_ignore",
				ObjectType: "source_change", ObjectID: changeID.String(),
				Summary: jsonSummary(map[string]any{"field": change.Field}),
			})
		})
		if err != nil {
			return nil, err
		}
		return s.AdminGame(ctx, change.GameID)
	}

	// Accept: apply to a draft revision under the usual optimistic locking.
	err = db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		game, err := q.GetGameForUpdate(ctx, change.GameID)
		if err != nil {
			return gameErr(err)
		}
		if revisionVersion != nil && int(game.RevisionVersion) != *revisionVersion {
			return httpx.RevisionConflict()
		}
		rev, err := s.ensureDraft(ctx, q, game, actorOf("admin", adminID))
		if err != nil {
			return err
		}
		if err := s.applyChangeField(ctx, q, rev, change); err != nil {
			return err
		}
		if _, err := q.BumpRevisionVersion(ctx, game.ID); err != nil {
			return err
		}
		if err := q.ResolveSourceChange(ctx, sqlc.ResolveSourceChangeParams{
			ID: changeID, State: "accepted", ResolvedAt: nowPtr(s.Clock.Now()), ResolvedBy: adminID,
		}); err != nil {
			return err
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actorOf("admin", adminID), Action: "source.change_accept",
			ObjectType: "source_change", ObjectID: changeID.String(),
			Summary: jsonSummary(map[string]any{"field": change.Field, "newValue": jsonRaw(change.NewValue)}),
		})
	})
	if err != nil {
		return nil, err
	}
	return s.AdminGame(ctx, change.GameID)
}

// applyChangeField writes one accepted change into the draft revision.
func (s *Service) applyChangeField(ctx context.Context, q *sqlc.Queries, rev sqlc.GameRevision, change sqlc.GetSourceChangeRow) error {
	fields := map[string]string{}
	switch change.Field {
	case "name":
		var v string
		if err := json.Unmarshal(change.NewValue, &v); err != nil {
			return httpx.Validation(map[string]string{"newValue": "must be a string"})
		}
		if !validLen(fields, "name", v, 1, 150) {
			return httpx.Validation(fields)
		}
		_, err := q.UpdateRevision(ctx, sqlc.UpdateRevisionParams{ID: rev.ID, Name: pgText(v)})
		return err
	case "developer":
		var v string
		if err := json.Unmarshal(change.NewValue, &v); err != nil {
			return httpx.Validation(map[string]string{"newValue": "must be a string"})
		}
		if !validLen(fields, "developer", v, 0, 150) {
			return httpx.Validation(fields)
		}
		_, err := q.UpdateRevision(ctx, sqlc.UpdateRevisionParams{ID: rev.ID, Developer: pgText(v)})
		return err
	case "primary_category":
		var v string
		if err := json.Unmarshal(change.NewValue, &v); err != nil {
			return httpx.Validation(map[string]string{"newValue": "must be a string"})
		}
		if _, err := q.GetCategory(ctx, v); err != nil {
			return httpx.Validation(map[string]string{"primaryCategory": "unknown category"})
		}
		_, err := q.UpdateRevision(ctx, sqlc.UpdateRevisionParams{ID: rev.ID, PrimaryCategory: pgText(v)})
		return err
	case "tags":
		var tags []string
		if err := json.Unmarshal(change.NewValue, &tags); err != nil {
			return httpx.Validation(map[string]string{"newValue": "must be an array of tag slugs"})
		}
		raw, err := json.Marshal(tags)
		if err != nil {
			return err
		}
		tags, err = s.mappedTags(ctx, sqlc.SourceGame{Tags: raw})
		if err != nil {
			return err
		}
		_, err = q.UpdateRevision(ctx, sqlc.UpdateRevisionParams{ID: rev.ID, Tags: cleanTags(tags)})
		return err
	case "device_flags":
		var flags map[string]bool
		if err := json.Unmarshal(change.NewValue, &flags); err != nil {
			return httpx.Validation(map[string]string{"newValue": "must be a device flag object"})
		}
		support := "desktop"
		switch {
		case flags["ios"] && flags["android"]:
			support = "both"
		case flags["ios"] || flags["android"]:
			support = "mobile"
		}
		_, err := q.UpdateRevision(ctx, sqlc.UpdateRevisionParams{ID: rev.ID, DeviceSupport: pgText(support)})
		return err
	default:
		return httpx.Validation(map[string]string{"field": "unsupported change field"})
	}
}

// jsonRaw decodes a jsonb value into its Go representation for summaries.
func jsonRaw(raw []byte) any {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return string(raw)
	}
	return v
}
