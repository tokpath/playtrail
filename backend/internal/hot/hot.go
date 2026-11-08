// Package hot manages hot snapshot batches (PRD 06, §4.7): manual creation,
// review, deactivation, and the public read with the 48-hour staleness rule.
package hot

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"playtrail/backend/internal/audit"
	"playtrail/backend/internal/crawler"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/db"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/validate"
)

const staleAfter = 48 * time.Hour

type Service struct {
	Catalog *catalog.Service
}

// Item is one snapshot entry as returned by admin endpoints.
type Item struct {
	Position   int        `json:"position"`
	SourceSlug string     `json:"sourceSlug"`
	GameID     *uuid.UUID `json:"gameId"`
}

// Snapshot is an admin hot snapshot batch.
type Snapshot struct {
	ID              uuid.UUID `json:"id"`
	SourceURL       string    `json:"sourceUrl"`
	SourceFetchedAt string    `json:"sourceFetchedAt"`
	CacheNote       string    `json:"cacheNote"`
	Definition      string    `json:"definition"`
	ObservedRegion  string    `json:"observedRegion"`
	ReviewState     string    `json:"reviewState"`
	Active          bool      `json:"active"`
	CreatedBy       string    `json:"createdBy"`
	CreatedAt       string    `json:"createdAt"`
	Items           []Item    `json:"items"`
}

func snapshotOf(ctx context.Context, q *sqlc.Queries, row sqlc.HotSnapshot) (Snapshot, error) {
	items, err := q.ListHotSnapshotItems(ctx, row.ID)
	if err != nil {
		return Snapshot{}, err
	}
	out := Snapshot{
		ID: row.ID, SourceURL: row.SourceUrl,
		SourceFetchedAt: row.SourceFetchedAt.Format(time.RFC3339),
		CacheNote:       row.CacheNote, Definition: row.Definition,
		ObservedRegion: row.ObservedRegion, ReviewState: row.ReviewState,
		Active: row.Active, CreatedBy: row.CreatedBy,
		CreatedAt: row.CreatedAt.Format(time.RFC3339),
		Items:     make([]Item, 0, len(items)),
	}
	for _, it := range items {
		id := it.GameID
		out.Items = append(out.Items, Item{Position: int(it.Position), SourceSlug: it.SourceSlug, GameID: id})
	}
	return out, nil
}

// List returns all batches (newest first).
func (s *Service) List(ctx context.Context) ([]Snapshot, error) {
	rows, err := s.Catalog.Q.ListHotSnapshots(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Snapshot, 0, len(rows))
	for _, r := range rows {
		snap, err := snapshotOf(ctx, s.Catalog.Q, r)
		if err != nil {
			return nil, err
		}
		out = append(out, snap)
	}
	return out, nil
}

// CreateInput is the POST /admin/hot-snapshots body.
type CreateInput struct {
	SourceURL       string `json:"sourceUrl"`
	SourceFetchedAt string `json:"sourceFetchedAt"`
	ObservedRegion  string `json:"observedRegion"`
	Definition      string `json:"definition"`
	CacheNote       string `json:"cacheNote"`
	Items           []struct {
		Position   int    `json:"position"`
		SourceSlug string `json:"sourceSlug"`
	} `json:"items"`
}

// Create stores a new pending batch. Items map to site games through the
// source row or the canonical external URL (22.5) — never our own slug, which
// may differ from the CrazyGames slug. Unmapped entries stay unmapped.
func (s *Service) Create(ctx context.Context, in CreateInput, adminID *uuid.UUID) (*Snapshot, error) {
	fields := map[string]string{}
	if len(in.Items) == 0 || len(in.Items) > 20 {
		fields["items"] = "1-20 items required"
	}
	source, err := validate.HTTPSField("sourceUrl", in.SourceURL)
	if err != nil {
		mergeField(fields, err)
	}
	fetchedAt, err := validate.TimeField("sourceFetchedAt", in.SourceFetchedAt, s.Catalog.Clock.Now(), 0, false)
	if err != nil {
		mergeField(fields, err)
	}
	if err := validate.RequiredField("observedRegion", in.ObservedRegion); err != nil {
		mergeField(fields, err)
	}
	if err := validate.RequiredField("definition", in.Definition); err != nil {
		mergeField(fields, err)
	}
	seenPos, seenSlug := map[int]bool{}, map[string]bool{}
	for _, it := range in.Items {
		if it.Position < 1 {
			fields["items"] = "positions must be positive"
		}
		if seenPos[it.Position] || seenSlug[it.SourceSlug] {
			fields["items"] = "positions and source slugs must be unique"
		}
		seenPos[it.Position], seenSlug[it.SourceSlug] = true, true
		if err := validate.SlugField("items", it.SourceSlug); err != nil {
			fields["items"] = "invalid source slug"
		}
		if it.SourceSlug == "" {
			fields["items"] = "sourceSlug is required"
		}
	}
	if len(fields) > 0 {
		return nil, httpx.Validation(fields)
	}

	var row sqlc.HotSnapshot
	err = db.InTx(ctx, s.Catalog.Pool, func(q *sqlc.Queries) error {
		var err error
		row, err = q.InsertHotSnapshot(ctx, sqlc.InsertHotSnapshotParams{
			SourceUrl: source, SourceFetchedAt: fetchedAt, CacheNote: in.CacheNote,
			Definition: in.Definition, ObservedRegion: in.ObservedRegion,
			ReviewState: "pending", CreatedBy: actor(adminID),
		})
		if err != nil {
			return err
		}
		for _, it := range in.Items {
			var gameID *uuid.UUID
			if sg, err := q.GetSourceGameBySlug(ctx, it.SourceSlug); err == nil && sg.GameID != nil {
				gameID = sg.GameID
			} else if g, err := q.GetGameByExternalURL(ctx, crawler.CanonicalURL(it.SourceSlug)); err == nil {
				gameID = &g.ID
			}
			if err := q.InsertHotSnapshotItem(ctx, sqlc.InsertHotSnapshotItemParams{
				SnapshotID: row.ID, Position: int32(it.Position), SourceSlug: it.SourceSlug, GameID: gameID,
			}); err != nil {
				return err
			}
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actor(adminID), Action: "hot.create",
			ObjectType: "hot_snapshot", ObjectID: row.ID.String(),
			Summary: jsonSummary(map[string]any{"items": len(in.Items)}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.Catalog.Notify("hot")
	snap, err := snapshotOf(ctx, s.Catalog.Q, row)
	return &snap, err
}

// Review approves or rejects a batch.
func (s *Service) Review(ctx context.Context, id uuid.UUID, decision string, adminID *uuid.UUID) (*Snapshot, error) {
	if err := validate.EnumField("decision", decision, "approved", "rejected"); err != nil {
		return nil, err
	}
	var row sqlc.HotSnapshot
	err := db.InTx(ctx, s.Catalog.Pool, func(q *sqlc.Queries) error {
		var err error
		row, err = q.SetHotSnapshotReview(ctx, sqlc.SetHotSnapshotReviewParams{ID: id, ReviewState: decision})
		if err != nil {
			return snapshotErr(err)
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actor(adminID), Action: "hot.review",
			ObjectType: "hot_snapshot", ObjectID: id.String(),
			Summary: jsonSummary(map[string]any{"decision": decision}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.Catalog.Notify("hot")
	snap, err := snapshotOf(ctx, s.Catalog.Q, row)
	return &snap, err
}

// Deactivate hides a batch from all public surfaces.
func (s *Service) Deactivate(ctx context.Context, id uuid.UUID, adminID *uuid.UUID) (*Snapshot, error) {
	var row sqlc.HotSnapshot
	err := db.InTx(ctx, s.Catalog.Pool, func(q *sqlc.Queries) error {
		var err error
		row, err = q.DeactivateHotSnapshot(ctx, id)
		if err != nil {
			return snapshotErr(err)
		}
		return audit.Add(ctx, q, audit.Entry{
			AdminID: adminID, Actor: actor(adminID), Action: "hot.deactivate",
			ObjectType: "hot_snapshot", ObjectID: id.String(), Summary: jsonSummary(map[string]any{}),
		})
	})
	if err != nil {
		return nil, err
	}
	s.Catalog.Notify("hot")
	snap, err := snapshotOf(ctx, s.Catalog.Q, row)
	return &snap, err
}

// CreateFromCrawler stores a snapshot batch from the crawler: items map to
// published games by slug, positions are preserved, and the review state
// follows the crawler's auto-publish setting (PRD 22.9). created_by is
// 'system'.
func (s *Service) CreateFromCrawler(ctx context.Context, in crawler.HotSnapshotInput) (uuid.UUID, int, error) {
	if len(in.Items) == 0 {
		return uuid.Nil, 0, httpx.InvalidParam("no hot items")
	}
	review := "pending"
	if in.AutoPublish {
		review = "approved"
	}
	var row sqlc.HotSnapshot
	mapped := 0
	err := db.InTx(ctx, s.Catalog.Pool, func(q *sqlc.Queries) error { //nolint:dupl // crawler batch shares the manual snapshot tables
		var err error
		row, err = q.InsertHotSnapshot(ctx, sqlc.InsertHotSnapshotParams{
			SourceUrl: in.SourceURL, SourceFetchedAt: in.FetchedAt, CacheNote: "",
			Definition: in.Definition, ObservedRegion: in.ObservedRegion,
			ReviewState: review, CreatedBy: "system",
		})
		if err != nil {
			return err
		}
		for _, item := range in.Items {
			var gameID *uuid.UUID
			// 22.5: resolve through the source's canonical external URL (or a
			// linked source row), never through our own games.slug — the two
			// slug spaces may differ.
			if sg, err := q.GetSourceGameBySlug(ctx, item.Slug); err == nil && sg.GameID != nil {
				gameID = sg.GameID
				mapped++
			} else if g, err := q.GetGameByExternalURL(ctx, crawler.CanonicalURL(item.Slug)); err == nil && g.Status == "published" {
				gameID = &g.ID
				mapped++
			}
			if err := q.InsertHotSnapshotItem(ctx, sqlc.InsertHotSnapshotItemParams{
				SnapshotID: row.ID, Position: int32(item.Position),
				SourceSlug: item.Slug, GameID: gameID,
			}); err != nil {
				return err
			}
		}
		return audit.Add(ctx, q, audit.Entry{
			Actor: "system", Action: "hot.crawler_create",
			ObjectType: "hot_snapshot", ObjectID: row.ID.String(),
			Summary: jsonSummary(map[string]any{"items": len(in.Items), "mapped": mapped, "autoPublish": in.AutoPublish}),
		})
	})
	if err != nil {
		return uuid.Nil, 0, err
	}
	return row.ID, mapped, nil
}

// PublicSnapshot returns the latest active approved batch for the locale, or
// nil. Items without a published game in the locale are filtered out and
// positions are preserved (§4.7). The snapshot is included even when stale
// (/hot shows it as historical); the home endpoint hides stale snapshots.
func (s *Service) PublicSnapshot(ctx context.Context, locale string) (*PublicHotSnapshot, error) {
	row, err := s.Catalog.Q.GetLatestPublicHotSnapshot(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	now := s.Catalog.Clock.Now()
	out := &PublicHotSnapshot{
		SnapshotID:      row.ID,
		SourceURL:       row.SourceUrl,
		SourceFetchedAt: row.SourceFetchedAt.Format(time.RFC3339),
		ObservedRegion:  row.ObservedRegion,
		Definition:      row.Definition,
		Stale:           now.After(row.SourceFetchedAt.Add(staleAfter)),
	}
	items, err := s.Catalog.Q.ListHotSnapshotItems(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	var ids []uuid.UUID
	byID := map[uuid.UUID]sqlc.PublicGame{}
	for _, it := range items {
		if it.GameID != nil {
			ids = append(ids, *it.GameID)
		}
	}
	if len(ids) > 0 {
		rows, err := s.Catalog.Q.ListPublicGamesByIDs(ctx, sqlc.ListPublicGamesByIDsParams{Locale: locale, Ids: ids})
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			byID[r.GameID] = r
		}
	}
	ordered := make([]sqlc.PublicGame, 0, len(items))
	positions := make([]int, 0, len(items))
	for _, it := range items {
		if it.GameID == nil {
			continue
		}
		if pg, ok := byID[*it.GameID]; ok {
			ordered = append(ordered, pg)
			positions = append(positions, int(it.Position))
		}
	}
	cards, err := s.Catalog.GameCardsForRows(ctx, ordered, locale)
	if err != nil {
		return nil, err
	}
	out.Items = make([]HotItem, 0, len(cards))
	for i, card := range cards {
		out.Items = append(out.Items, HotItem{Position: positions[i], Game: card})
	}
	return out, nil
}

// PublicHotSnapshot is the public snapshot shape (§6.1).
type PublicHotSnapshot struct {
	SnapshotID      uuid.UUID `json:"snapshotId"`
	SourceURL       string    `json:"sourceUrl"`
	SourceFetchedAt string    `json:"sourceFetchedAt"`
	ObservedRegion  string    `json:"observedRegion"`
	Definition      string    `json:"definition"`
	Stale           bool      `json:"stale"`
	Items           []HotItem `json:"items"`
}

// HotItem keeps the original source position.
type HotItem struct {
	Position int              `json:"position"`
	Game     catalog.GameCard `json:"game"`
}

func snapshotErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("snapshot not found")
	}
	return err
}

func actor(adminID *uuid.UUID) string {
	if adminID != nil {
		return adminID.String()
	}
	return "system"
}

func mergeField(into map[string]string, err error) {
	if apiErr, ok := err.(*httpx.Error); ok {
		for k, v := range apiErr.FieldErrors {
			into[k] = v
		}
	}
}

func jsonSummary(v any) []byte {
	raw, _ := json.Marshal(v)
	return raw
}
