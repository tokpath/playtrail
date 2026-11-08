// Package events implements the stats-event ingest (PRD 11, §4.8): strict
// JSON with a field whitelist, per-IP in-memory token bucket, event_id
// dedupe, OPS_TIMEZONE daily aggregation, and retention cleanup. IPs are
// never stored.
package events

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"playtrail/backend/internal/clock"
	"playtrail/backend/internal/db"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/validate"
)

// Event is the whitelisted POST /api/events body (PRD 11 + appendix B).
type Event struct {
	EventID      string  `json:"eventId"`
	EventName    string  `json:"eventName"`
	GameID       string  `json:"gameId"`
	SourceGameID *string `json:"sourceGameId"`
	PageType     string  `json:"pageType"`
	PagePath     string  `json:"pagePath"`
	Locale       string  `json:"locale"`
	OccurredAt   string  `json:"occurredAt"`
	Placement    string  `json:"placement"`
	EntrySource  string  `json:"entrySource"`
}

var (
	validEventNames  = []string{"game_view", "outbound_click", "related_click"}
	validPlacements  = []string{"detail_page", "detail_primary", "detail_related"}
	validEntrySource = []string{"home_featured", "home_hot", "category", "search", "related", "direct_or_unknown"}
)

// Service depends on the catalog only for the public_games existence check.
type Service struct {
	Catalog Catalog
	Q       *sqlc.Queries
	Pool    *pgxpool.Pool
	Clock   clock.Clock
	limiter *rateLimiter
}

// Catalog is the catalog surface events needs.
type Catalog interface {
	HasPublicGame(ctx context.Context, gameID uuid.UUID, locale string) (bool, error)
}

func NewService(cat Catalog, q *sqlc.Queries, pool *pgxpool.Pool, clk clock.Clock) *Service {
	return &Service{Catalog: cat, Q: q, Pool: pool, Clock: clk, limiter: newRateLimiter(1, 30)}
}

// Ingest validates and stores one event. gameId must exist in public_games
// for the event locale; related_click additionally carries sourceGameId.
// Dedupe happens in the database via the event_id primary key (§4.8).
func (s *Service) Ingest(ctx context.Context, ev Event, locale string) error {
	fields := map[string]string{}
	eventID, err := uuid.Parse(ev.EventID)
	if err != nil {
		fields["eventId"] = "must be a UUID"
	}
	if err := validate.EnumField("eventName", ev.EventName, validEventNames...); err != nil {
		mergeField(fields, err)
	}
	gameID, err := uuid.Parse(ev.GameID)
	if err != nil {
		fields["gameId"] = "must be a UUID"
	}
	var sourceGameID *uuid.UUID
	if ev.SourceGameID != nil && *ev.SourceGameID != "" {
		id, err := uuid.Parse(*ev.SourceGameID)
		if err != nil {
			fields["sourceGameId"] = "must be a UUID"
		} else {
			sourceGameID = &id
		}
	}
	if err := validate.LenField("pageType", ev.PageType, 1, 100); err != nil {
		mergeField(fields, err)
	}
	if err := validate.LenField("pagePath", ev.PagePath, 1, 300); err != nil {
		mergeField(fields, err)
	}
	if err := validate.EnumField("placement", ev.Placement, validPlacements...); err != nil {
		mergeField(fields, err)
	}
	if err := validate.EnumField("entrySource", ev.EntrySource, validEntrySource...); err != nil {
		mergeField(fields, err)
	}
	occurredAt, err := time.Parse(time.RFC3339, ev.OccurredAt)
	if err != nil {
		fields["occurredAt"] = "must be RFC 3339 with offset"
	}
	if len(fields) > 0 {
		return &httpx.Error{Status: 400, Code: httpx.CodeInvalidParam, Message: "invalid event", FieldErrors: fields}
	}

	// The game must be published in the event's locale (§4.8).
	exists, err := s.Catalog.HasPublicGame(ctx, gameID, locale)
	if err != nil {
		return err
	}
	if !exists {
		return httpx.InvalidParam("unknown gameId for locale")
	}
	if sourceGameID != nil {
		srcExists, err := s.Catalog.HasPublicGame(ctx, *sourceGameID, locale)
		if err != nil {
			return err
		}
		if !srcExists {
			return httpx.InvalidParam("unknown sourceGameId for locale")
		}
	}

	return s.Q.InsertEventRaw(ctx, sqlc.InsertEventRawParams{
		EventID:      eventID,
		EventName:    ev.EventName,
		GameID:       gameID,
		SourceGameID: sourceGameID,
		PageType:     ev.PageType,
		PagePath:     ev.PagePath,
		Locale:       locale,
		Placement:    ev.Placement,
		EntrySource:  ev.EntrySource,
		OccurredAt:   occurredAt,
		ReceivedAt:   s.Clock.Now(),
	})
}

// ---- per-IP token bucket (in-memory only; IPs never touch disk) ----

type bucket struct {
	tokens float64
	last   time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64
}

func newRateLimiter(rate, burst float64) *rateLimiter {
	rl := &rateLimiter{
		buckets: map[string]*bucket{},
		rate:    rate,
		burst:   burst,
	}
	go rl.sweep()
	return rl
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: rl.burst, last: now}
		rl.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * rl.rate
	if b.tokens > rl.burst {
		b.tokens = rl.burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (rl *rateLimiter) sweep() {
	ticker := time.NewTicker(10 * time.Minute)
	for range ticker.C {
		rl.mu.Lock()
		for k, b := range rl.buckets {
			if time.Since(b.last) > time.Hour {
				delete(rl.buckets, k)
			}
		}
		rl.mu.Unlock()
	}
}

// Allow reports whether this client IP may submit an event now.
func (s *Service) Allow(ip string) bool { return s.limiter.allow(ip) }

// ---- worker jobs (§4.8) ----

// AggregateDay recomputes events_daily for the given OPS_TIMEZONE day (full
// recompute, idempotent).
func (s *Service) AggregateDay(ctx context.Context, day time.Time, tz *time.Location) error {
	start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, tz)
	end := start.AddDate(0, 0, 1)
	return db.InTx(ctx, s.Pool, func(q *sqlc.Queries) error {
		rows, err := q.AggregateEventsRange(ctx, sqlc.AggregateEventsRangeParams{StartAt: start, EndAt: end})
		if err != nil {
			return err
		}
		if err := q.DeleteEventsDailyDay(ctx, start); err != nil {
			return err
		}
		for _, r := range rows {
			if err := q.InsertEventsDaily(ctx, sqlc.InsertEventsDailyParams{
				Day: start, GameID: r.GameID, Locale: r.Locale, EventName: r.EventName, Count: r.Count,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// CleanupRetention deletes raw events older than 30 days and daily
// aggregates older than 90 days (PRD 11).
func (s *Service) CleanupRetention(ctx context.Context, now time.Time) (int64, int64, error) {
	raw, err := s.Q.DeleteEventsRawBefore(ctx, now.AddDate(0, 0, -30))
	if err != nil {
		return 0, 0, err
	}
	daily, err := s.Q.DeleteEventsDailyBefore(ctx, now.AddDate(0, 0, -90))
	if err != nil {
		return raw, 0, err
	}
	return raw, daily, nil
}

// CleanupSessions deletes expired scs session rows.
func (s *Service) CleanupSessions(ctx context.Context) (int64, error) {
	return s.Q.DeleteExpiredSessions(ctx)
}

// ---- stats report (§6.3 GET /admin/stats) ----

type StatsParams struct {
	From   string
	To     string
	GameID string
	Locale string
}

type StatsReport struct {
	Days   []StatsDay    `json:"days"`
	Totals StatsTotals   `json:"totals"`
	ByGame []StatsByGame `json:"byGame"`
	Notes  string        `json:"notes"`
}

type StatsDay struct {
	Day            string `json:"day"`
	GameViews      int    `json:"gameViews"`
	OutboundClicks int    `json:"outboundClicks"`
	RelatedClicks  int    `json:"relatedClicks"`
}

type StatsTotals struct {
	GameViews      int     `json:"gameViews"`
	OutboundClicks int     `json:"outboundClicks"`
	RelatedClicks  int     `json:"relatedClicks"`
	CTR            float64 `json:"ctr"`
}

type StatsByGame struct {
	GameID         uuid.UUID `json:"gameId"`
	Name           string    `json:"name"`
	GameViews      int       `json:"gameViews"`
	OutboundClicks int       `json:"outboundClicks"`
	CTR            float64   `json:"ctr"`
}

const statsNotes = "Counts are event counts, not unique visitors. Ad blockers, offline browsers, and robots can cause undercounting; duplicate eventId submissions are recorded once."

// Stats assembles the admin stats report for the inclusive date range
// interpreted in OPS_TIMEZONE (max 90 days).
func (s *Service) Stats(ctx context.Context, tz *time.Location, p StatsParams, locales []string) (*StatsReport, error) {
	fields := map[string]string{}
	from, err1 := time.ParseInLocation("2006-01-02", p.From, tz)
	to, err2 := time.ParseInLocation("2006-01-02", p.To, tz)
	if err1 != nil {
		fields["from"] = "must be YYYY-MM-DD"
	}
	if err2 != nil {
		fields["to"] = "must be YYYY-MM-DD"
	}
	if to.Before(from) {
		fields["to"] = "must not be before from"
	}
	if from.AddDate(0, 0, 90).Before(to) {
		fields["from"] = "range exceeds 90 days"
	}
	if p.Locale != "" {
		ok := false
		for _, l := range locales {
			if l == p.Locale {
				ok = true
			}
		}
		if !ok {
			fields["locale"] = "unsupported locale"
		}
	}
	gameID := uuid.Nil
	if p.GameID != "" {
		id, err := uuid.Parse(p.GameID)
		if err != nil {
			fields["gameId"] = "must be a UUID"
		} else {
			gameID = id
		}
	}
	if len(fields) > 0 {
		return nil, &httpx.Error{Status: 400, Code: httpx.CodeInvalidParam, Message: "invalid parameters", FieldErrors: fields}
	}

	rows, err := s.Q.StatsAggregate(ctx, sqlc.StatsAggregateParams{
		Tz: tz.String(), StartAt: from, EndAt: to.AddDate(0, 0, 1), GameID: optUUID(gameID), Locale: optText(p.Locale),
	})
	if err != nil {
		return nil, err
	}

	totals := StatsTotals{}
	dayMap := map[string]*StatsDay{}
	gameMap := map[uuid.UUID]*StatsByGame{}
	for _, r := range rows {
		dayKey := r.Day.Format("2006-01-02")
		d, ok := dayMap[dayKey]
		if !ok {
			d = &StatsDay{Day: dayKey}
			dayMap[dayKey] = d
		}
		g, ok := gameMap[r.GameID]
		if !ok {
			g = &StatsByGame{GameID: r.GameID}
			gameMap[r.GameID] = g
		}
		switch r.EventName {
		case "game_view":
			d.GameViews += int(r.Count)
			totals.GameViews += int(r.Count)
			g.GameViews += int(r.Count)
		case "outbound_click":
			d.OutboundClicks += int(r.Count)
			totals.OutboundClicks += int(r.Count)
			g.OutboundClicks += int(r.Count)
		case "related_click":
			d.RelatedClicks += int(r.Count)
			totals.RelatedClicks += int(r.Count)
		}
	}

	days := make([]StatsDay, 0, len(dayMap))
	for _, d := range dayMap {
		days = append(days, *d)
	}
	sort.Slice(days, func(i, j int) bool { return days[i].Day < days[j].Day })

	byGame := make([]StatsByGame, 0, len(gameMap))
	for _, g := range gameMap {
		if g.GameViews > 0 {
			g.CTR = float64(g.OutboundClicks) / float64(g.GameViews)
		}
		byGame = append(byGame, *g)
	}
	sort.Slice(byGame, func(i, j int) bool { return byGame[i].GameViews > byGame[j].GameViews })

	if totals.GameViews > 0 {
		totals.CTR = float64(totals.OutboundClicks) / float64(totals.GameViews)
	}

	if len(byGame) > 0 {
		ids := make([]uuid.UUID, 0, len(byGame))
		for _, g := range byGame {
			ids = append(ids, g.GameID)
		}
		nameRows, err := s.Q.ListGameNames(ctx, ids)
		if err != nil {
			return nil, err
		}
		nameBy := map[uuid.UUID]string{}
		for _, nr := range nameRows {
			nameBy[nr.ID] = nr.Name
		}
		for i := range byGame {
			byGame[i].Name = nameBy[byGame[i].GameID]
		}
	}
	if byGame == nil {
		byGame = []StatsByGame{}
	}
	if days == nil {
		days = []StatsDay{}
	}
	return &StatsReport{Days: days, Totals: totals, ByGame: byGame, Notes: statsNotes}, nil
}

func optUUID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

func optText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func mergeField(into map[string]string, err error) {
	if apiErr, ok := err.(*httpx.Error); ok {
		for k, v := range apiErr.FieldErrors {
			into[k] = v
		}
	}
}
