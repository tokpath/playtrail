package catalog

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"playtrail/backend/internal/clock"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/media"
)

// Service holds shared dependencies for the catalog domain.
type Service struct {
	Pool  *pgxpool.Pool
	Q     *sqlc.Queries
	Clock clock.Clock
	Media *media.Service

	BaseURL        string
	Locales        []string
	DefaultLocale  string
	LocaleMinGames int
	// ExternalCovers enables hotlinked CrazyGames covers (PRD 22.12).
	ExternalCovers bool
	// Notify invalidates web cache tags after committed public changes (§7).
	Notify func(tags ...string)

	dictMu    sync.Mutex
	dictCats  []sqlc.Category
	dictTags  []sqlc.Tag
	catExpiry time.Time
	tagExpiry time.Time

	liveMu     sync.Mutex
	liveCached []string
	liveExpiry time.Time
}

func NewService(pool *pgxpool.Pool, clk clock.Clock, m *media.Service, baseURL string, locales []string, defaultLocale string, localeMinGames int, externalCovers bool, notify func(tags ...string)) *Service {
	return &Service{
		Pool:           pool,
		Q:              sqlc.New(pool),
		Clock:          clk,
		Media:          m,
		BaseURL:        baseURL,
		Locales:        locales,
		DefaultLocale:  defaultLocale,
		LocaleMinGames: localeMinGames,
		ExternalCovers: externalCovers,
		Notify:         notify,
	}
}

// IsSupported reports whether locale is in SUPPORTED_LOCALES.
func (s *Service) IsSupported(locale string) bool {
	for _, l := range s.Locales {
		if l == locale {
			return true
		}
	}
	return false
}

// Categories returns the category dictionary, cached for 30s (it only feeds
// display names, so the 60s consistency bound is respected).
func (s *Service) Categories(ctx context.Context) ([]sqlc.Category, error) {
	s.dictMu.Lock()
	defer s.dictMu.Unlock()
	if time.Now().Before(s.catExpiry) {
		return s.dictCats, nil
	}
	cats, err := s.Q.ListCategories(ctx)
	if err != nil {
		return nil, err
	}
	s.dictCats = cats
	s.catExpiry = time.Now().Add(30 * time.Second)
	return cats, nil
}

// Tags returns the full tag dictionary with the same 30s cache.
func (s *Service) Tags(ctx context.Context) ([]sqlc.Tag, error) {
	s.dictMu.Lock()
	defer s.dictMu.Unlock()
	if time.Now().Before(s.tagExpiry) {
		return s.dictTags, nil
	}
	tags, err := s.Q.ListTags(ctx)
	if err != nil {
		return nil, err
	}
	s.dictTags = tags
	s.tagExpiry = time.Now().Add(30 * time.Second)
	return tags, nil
}

// LiveLocales returns the supported locales whose public game count has
// reached LOCALE_MIN_GAMES (§4.4), cached for 30 seconds.
func (s *Service) LiveLocales(ctx context.Context) ([]string, error) {
	s.liveMu.Lock()
	defer s.liveMu.Unlock()
	if s.liveCached != nil && time.Now().Before(s.liveExpiry) {
		return s.liveCached, nil
	}
	counts, err := s.Q.ListLiveLocaleCounts(ctx)
	if err != nil {
		return nil, err
	}
	countBy := make(map[string]int64, len(counts))
	for _, c := range counts {
		countBy[c.Locale] = c.Count
	}
	live := []string{}
	for _, l := range s.Locales {
		if countBy[l] >= int64(s.LocaleMinGames) {
			live = append(live, l)
		}
	}
	s.liveCached = live
	s.liveExpiry = time.Now().Add(30 * time.Second)
	return live, nil
}

// localeLimits are the PRD 8.2 per-locale length limits (code points).
type localeLimits struct {
	AliasMax    int
	SummaryMin  int
	SummaryMax  int
	DescMin     int
	DescMax     int
	ControlsMax int
}

func LimitsFor(locale string) localeLimits {
	if locale == "zh" {
		return localeLimits{AliasMax: 100, SummaryMin: 20, SummaryMax: 120, DescMin: 50, DescMax: 3000, ControlsMax: 1000}
	}
	return localeLimits{AliasMax: 100, SummaryMin: 40, SummaryMax: 300, DescMin: 100, DescMax: 5000, ControlsMax: 2000}
}

// timeString renders a time as RFC 3339, or nil for unset values.
func timeString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

// uuidsText converts a string slice into UUIDs, skipping malformed entries
// (they are validated separately).
func uuidsText(ids []string) ([]uuid.UUID, bool) {
	out := make([]uuid.UUID, 0, len(ids))
	for _, raw := range ids {
		id, err := uuid.Parse(raw)
		if err != nil {
			return nil, false
		}
		out = append(out, id)
	}
	return out, true
}
