package catalog

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/media"
	"playtrail/backend/internal/validate"
)

// MetaData assembles /api/meta.
func (s *Service) MetaData(ctx context.Context) (*Meta, error) {
	live, err := s.LiveLocales(ctx)
	if err != nil {
		return nil, err
	}
	return &Meta{
		SupportedLocales: s.Locales,
		LiveLocales:      live,
		DefaultLocale:    s.DefaultLocale,
	}, nil
}

// ListParams are the validated /api/games query parameters.
type ListParams struct {
	Locale   string
	Q        string
	Category string
	Tag      string
	Sort     string
	Page     int
	PageSize int
}

// ListGames implements §4.6 search and list semantics.
func (s *Service) ListGames(ctx context.Context, p ListParams) (*GameList, error) {
	fields := map[string]string{}
	if !s.IsSupported(p.Locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	if validate.Len(p.Q) > 80 {
		return nil, httpx.InvalidParam("q exceeds 80 code points")
	}
	sort := p.Sort
	if sort == "" {
		sort = "editorial"
	}
	if sort != "editorial" && sort != "newest" {
		return nil, httpx.InvalidParam("sort must be editorial or newest")
	}
	if p.Page < 1 {
		return nil, httpx.InvalidParam("page must be at least 1")
	}
	if p.PageSize < 1 || p.PageSize > 48 {
		return nil, httpx.InvalidParam("pageSize must be 1-48")
	}
	if p.Category != "" {
		if _, err := s.Q.GetCategory(ctx, p.Category); err != nil {
			fields["category"] = "unknown category"
		}
	}
	if p.Tag != "" {
		if _, err := s.Q.GetTag(ctx, p.Tag); err != nil {
			fields["tag"] = "unknown tag"
		}
	}
	if len(fields) > 0 {
		return nil, &httpx.Error{Status: 400, Code: httpx.CodeInvalidParam, Message: "invalid query parameters", FieldErrors: fields}
	}

	pattern := "%" + validate.EscapeLike(strings.ToLower(strings.TrimSpace(p.Q))) + "%"
	q := strings.TrimSpace(p.Q)
	args := sqlc.CountPublicGamesParams{
		Locale:   p.Locale,
		Q:        optTextParam(pattern),
		Category: optTextParam(p.Category),
		Tag:      optTextParam(p.Tag),
	}
	total, err := s.Q.CountPublicGames(ctx, args)
	if err != nil {
		return nil, err
	}
	listArgs := sqlc.ListPublicGamesByEditorialParams{
		Locale: p.Locale, Q: optTextParam(pattern), Category: optTextParam(p.Category), Tag: optTextParam(p.Tag),
		RowLimit: int32(p.PageSize), RowOffset: int32((p.Page - 1) * p.PageSize),
	}
	var rows []sqlc.PublicGame
	if sort == "newest" {
		rows, err = s.Q.ListPublicGamesByNewest(ctx, sqlc.ListPublicGamesByNewestParams(listArgs))
	} else {
		rows, err = s.Q.ListPublicGamesByEditorial(ctx, listArgs)
	}
	if err != nil {
		return nil, err
	}

	cards, err := s.cardsOf(ctx, rows, p.Locale, true)
	if err != nil {
		return nil, err
	}
	totalPages := 0
	if total > 0 {
		totalPages = int((total + int64(p.PageSize) - 1) / int64(p.PageSize))
	}
	var fq, fc, ft *string
	if q != "" {
		fq = &q
	}
	if p.Category != "" {
		fc = &p.Category
	}
	if p.Tag != "" {
		ft = &p.Tag
	}
	return &GameList{
		Items: cards, Total: int(total), Page: p.Page, PageSize: p.PageSize,
		TotalPages:     totalPages,
		AppliedFilters: AppliedFilter{Q: fq, Category: fc, Tag: ft, Sort: sort},
	}, nil
}

// optTextParam maps an empty filter to SQL NULL so the predicate drops out.
func optTextParam(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

// cardsOf converts public_games rows into GameCards. Tag refs come from the
// dictionary; shortList trims tags to the first 3 for card display.
func (s *Service) cardsOf(ctx context.Context, rows []sqlc.PublicGame, locale string, shortList bool) ([]GameCard, error) {
	cats, err := s.Categories(ctx)
	if err != nil {
		return nil, err
	}
	tags, err := s.Tags(ctx)
	if err != nil {
		return nil, err
	}
	catName := func(slug string) string {
		for _, c := range cats {
			if c.Slug == slug {
				return parseNames(c.Names)[locale]
			}
		}
		return slug
	}
	tagName := func(slug string) string {
		for _, t := range tags {
			if t.Slug == slug {
				return parseNames(t.Names)[locale]
			}
		}
		return slug
	}

	cards := make([]GameCard, 0, len(rows))
	for _, row := range rows {
		refTags := make([]Ref, 0, len(row.Tags))
		for _, slug := range row.Tags {
			refTags = append(refTags, Ref{Slug: slug, Name: tagName(slug)})
			if shortList && len(refTags) == 3 {
				break
			}
		}
		card := GameCard{
			ID: row.GameID, Slug: row.Slug, Name: row.Name, Alias: row.Alias,
			Summary:         row.Summary,
			PrimaryCategory: Ref{Slug: row.PrimaryCategory, Name: catName(row.PrimaryCategory)},
			Tags:            refTags,
			Cover:           media.CoverImage(row.Cover),
			OutboundAllowed: row.OutboundAllowed,
		}
		cards = append(cards, card)
	}
	return cards, nil
}

// GameCardsForRows builds public cards for arbitrary public_games rows; used
// by the hot package to render snapshot items in original positions.
func (s *Service) GameCardsForRows(ctx context.Context, rows []sqlc.PublicGame, locale string) ([]GameCard, error) {
	return s.cardsOf(ctx, rows, locale, true)
}

// FeaturedGames returns up to 12 featured cards for the home endpoint.
func (s *Service) FeaturedGames(ctx context.Context, locale string) ([]GameCard, error) {
	if !s.IsSupported(locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	rows, err := s.Q.ListFeaturedGames(ctx, locale)
	if err != nil {
		return nil, err
	}
	return s.cardsOf(ctx, rows, locale, true)
}

// CategoryCounts lists categories with count > 0 for the locale.
func (s *Service) CategoryCounts(ctx context.Context, locale string) ([]CategoryCount, error) {
	if !s.IsSupported(locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	rows, err := s.Q.CategoryCounts(ctx, locale)
	if err != nil {
		return nil, err
	}
	out := make([]CategoryCount, 0, len(rows))
	for _, r := range rows {
		out = append(out, CategoryCount{
			Ref{Slug: r.Slug, Name: parseNames(r.Names)[locale]}, int(r.Count), int(r.SortOrder),
		})
	}
	return out, nil
}

// CategoryCountOf returns one category (count may be 0). Unknown slug → 404.
func (s *Service) CategoryCountOf(ctx context.Context, locale, slug string) (*CategoryCount, error) {
	if !s.IsSupported(locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	rows, err := s.Q.CategoryCount(ctx, sqlc.CategoryCountParams{Locale: locale, Slug: slug})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, httpx.NotFound("unknown category")
	}
	r := rows[0]
	return &CategoryCount{Ref{Slug: r.Slug, Name: parseNames(r.Names)[locale]}, int(r.Count), int(r.SortOrder)}, nil
}

// TagCounts lists tags with count > 0 for the locale.
func (s *Service) TagCounts(ctx context.Context, locale string) ([]TagCount, error) {
	if !s.IsSupported(locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	rows, err := s.Q.TagCounts(ctx, locale)
	if err != nil {
		return nil, err
	}
	out := make([]TagCount, 0, len(rows))
	for _, r := range rows {
		out = append(out, TagCount{Ref{Slug: r.Slug, Name: parseNames(r.Names)[locale]}, int(r.Count)})
	}
	return out, nil
}

// TotalGames is the count of published games in a locale.
func (s *Service) TotalGames(ctx context.Context, locale string) (int, error) {
	n, err := s.Q.CountPublicGamesByLocale(ctx, locale)
	return int(n), err
}

// HomeUpdatedAt is the latest published_at among the locale's live games
// (null when none) — used for the home response's updatedAt.
func (s *Service) HomeUpdatedAt(ctx context.Context, locale string) (*time.Time, error) {
	t, err := s.Q.LatestPublishedAt(ctx, locale)
	if err != nil {
		return nil, err
	}
	if t.IsZero() {
		return nil, nil
	}
	return &t, nil
}

// CategoryCount is a Ref plus per-locale published count.
type CategoryCount struct {
	Ref
	Count     int `json:"count"`
	SortOrder int `json:"sortOrder"`
}

// TagCount is a Ref plus per-locale published count.
type TagCount struct {
	Ref
	Count int `json:"count"`
}

// SitemapData is the /api/sitemap response.
type SitemapData struct {
	Games      []SitemapGame     `json:"games"`
	Categories []SitemapCategory `json:"categories"`
}

type SitemapGame struct {
	Slug      string    `json:"slug"`
	UpdatedAt time.Time `json:"updatedAt"`
	Locales   []string  `json:"locales"`
}

type SitemapCategory struct {
	Slug    string   `json:"slug"`
	Locales []string `json:"locales"`
}

// Sitemap assembles the sitemap entries over all published games.
func (s *Service) Sitemap(ctx context.Context, locale string) (*SitemapData, error) {
	if !s.IsSupported(locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	grows, err := s.Q.ListSitemapGames(ctx)
	if err != nil {
		return nil, err
	}
	crows, err := s.Q.ListSitemapCategories(ctx)
	if err != nil {
		return nil, err
	}
	data := &SitemapData{Games: make([]SitemapGame, 0, len(grows)), Categories: make([]SitemapCategory, 0, len(crows))}
	for _, r := range grows {
		locales := append([]string{}, r.Locales...)
		sort.Strings(locales)
		data.Games = append(data.Games, SitemapGame{Slug: r.Slug, UpdatedAt: r.UpdatedAt, Locales: locales})
	}
	for _, r := range crows {
		locales := append([]string{}, r.Locales...)
		sort.Strings(locales)
		data.Categories = append(data.Categories, SitemapCategory{Slug: r.Slug, Locales: locales})
	}
	return data, nil
}

// UnlistedSlugs serves the web proxy's 410 rewrite list.
func (s *Service) UnlistedSlugs(ctx context.Context) ([]string, error) {
	return s.Q.ListUnlistedSlugs(ctx)
}

// Detail assembles the public GameDetail (§6.1) including related games (§4.5).
func (s *Service) Detail(ctx context.Context, slug, locale string) (*GameDetail, error) {
	if !s.IsSupported(locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	row, err := s.Q.GetPublicGameBySlug(ctx, sqlc.GetPublicGameBySlugParams{Slug: slug, Locale: locale})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Distinguish 404 (not published in this locale) from 410 (unlisted).
			game, gerr := s.Q.GetGameBySlug(ctx, slug)
			if gerr == nil && game.Status == "unlisted" {
				return nil, httpx.Gone()
			}
			return nil, httpx.NotFound("game not found in this locale")
		}
		return nil, err
	}

	states, err := s.Q.ListLocaleStates(ctx, row.GameID)
	if err != nil {
		return nil, err
	}
	var available []string
	for _, st := range states {
		available = append(available, st.Locale)
	}
	sort.Strings(available)

	related, err := s.relatedOf(ctx, row, locale)
	if err != nil {
		return nil, err
	}

	var deviceEvidence *DeviceEvidence
	if row.DeviceEvidenceUrl != "" && row.DeviceCheckedAt != nil {
		deviceEvidence = &DeviceEvidence{URL: row.DeviceEvidenceUrl, CheckedAt: row.DeviceCheckedAt.Format(time.RFC3339)}
	}

	detail := &GameDetail{
		GameCard: GameCard{
			ID: row.GameID, Slug: row.Slug, Name: row.Name, Alias: row.Alias,
			Summary: row.Summary,
		},
		Description:      row.Description,
		Controls:         row.Controls,
		Developer:        row.Developer,
		DeviceSupport:    row.DeviceSupport,
		DeviceEvidence:   deviceEvidence,
		SourceURL:        row.SourceUrl,
		SourceFetchedAt:  row.SourceFetchedAt.Format(time.RFC3339),
		Screenshots:      media.ScreenshotsImage(row.Screenshots),
		CTAURL:           s.ctaURL(row.ExternalUrl, locale),
		AvailableLocales: available,
		FirstPublishedAt: row.FirstPublishedAt.Format(time.RFC3339),
		PublishedAt:      row.PublishedAt.Format(time.RFC3339),
		Related:          related,
	}
	if !row.OutboundAllowed {
		reason := "link_unavailable"
		detail.OutboundBlockedReason = &reason
	}
	// Detail lists all tags (≤8) with names; cardsOf trims to 3, so build here.
	cards, err := s.cardsOf(ctx, []sqlc.PublicGame{row}, locale, false)
	if err != nil {
		return nil, err
	}
	detail.GameCard = cards[0]
	detail.Tags = trimRefs(detail.Tags, 8)
	if detail.Screenshots == nil {
		detail.Screenshots = []media.Image{}
	}
	return detail, nil
}

func trimRefs(refs []Ref, n int) []Ref {
	if len(refs) > n {
		return refs[:n]
	}
	return refs
}

// ctaURL derives the per-locale CrazyGames link (PRD 22.8). P0 locales en and
// zh both map to the stored English URL.
func (s *Service) ctaURL(externalURL, locale string) string {
	return externalURL
}

// relatedOf computes the deterministic related games of PRD 18.2.
func (s *Service) relatedOf(ctx context.Context, row sqlc.PublicGame, locale string) ([]GameCard, error) {
	related, err := s.Q.ListRelatedGames(ctx, sqlc.ListRelatedGamesParams{
		Locale:   locale,
		GameID:   row.GameID,
		Category: row.PrimaryCategory,
		Tags:     row.Tags,
	})
	if err != nil {
		return nil, err
	}
	return s.cardsOf(ctx, related, locale, true)
}

// PublicGameByIDs is used by the events endpoint to validate game existence.
func (s *Service) HasPublicGame(ctx context.Context, gameID uuid.UUID, locale string) (bool, error) {
	return s.Q.HasPublicGame(ctx, sqlc.HasPublicGameParams{GameID: gameID, Locale: locale})
}

// PreviewDetail renders the candidate (draft, or last published) revision as
// a GameDetail for the admin preview endpoint (§6.3). It never touches
// public_games.
func (s *Service) PreviewDetail(ctx context.Context, gameID uuid.UUID, locale string) (*GameDetail, error) {
	if !s.IsSupported(locale) {
		return nil, httpx.InvalidParam("unsupported locale")
	}
	game, rev, err := s.candidateRevision(ctx, s.Q, gameID)
	if err != nil {
		return nil, err
	}
	cl, err := s.Q.GetRevisionLocale(ctx, sqlc.GetRevisionLocaleParams{RevisionID: rev.ID, Locale: locale})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("no draft content for this locale")
		}
		return nil, err
	}

	assets, err := s.loadAssets(ctx, s.Q, rev)
	if err != nil {
		return nil, err
	}
	alt := parseNames(cl.MediaAlt)
	cover := s.buildCover(rev, assets, coverAlt(rev, cl))
	screenshots := []media.Image{}
	for _, id := range rev.ScreenshotAssetIds {
		if a, ok := assets[id]; ok {
			if img := s.Media.PublicImage(a, alt[id.String()]); img != nil {
				screenshots = append(screenshots, *img)
			}
		}
	}

	states, err := s.Q.ListLocaleStates(ctx, game.ID)
	if err != nil {
		return nil, err
	}
	var available []string
	for _, st := range states {
		available = append(available, st.Locale)
	}
	sort.Strings(available)

	related, err := s.relatedForRevision(ctx, rev, locale)
	if err != nil {
		return nil, err
	}

	var deviceEvidence *DeviceEvidence
	if rev.DeviceEvidenceUrl != "" && rev.DeviceCheckedAt != nil {
		deviceEvidence = &DeviceEvidence{URL: rev.DeviceEvidenceUrl, CheckedAt: rev.DeviceCheckedAt.Format(time.RFC3339)}
	}

	detail := &GameDetail{
		GameCard: GameCard{
			ID:      game.ID,
			Slug:    game.Slug,
			Name:    rev.Name,
			Alias:   cl.Alias,
			Summary: cl.Summary,
			Cover:   cover,
		},
		Description:      cl.Description,
		Controls:         cl.Controls,
		Developer:        rev.Developer,
		DeviceSupport:    rev.DeviceSupport,
		DeviceEvidence:   deviceEvidence,
		SourceURL:        rev.SourceUrl,
		SourceFetchedAt:  rev.SourceFetchedAt.Format(time.RFC3339),
		Screenshots:      screenshots,
		CTAURL:           s.ctaURL(game.ExternalUrl, locale),
		AvailableLocales: available,
		Related:          related,
	}
	if rev.PrimaryCategory.Valid {
		detail.PrimaryCategory = Ref{Slug: rev.PrimaryCategory.String, Name: s.categoryName(ctx, rev.PrimaryCategory.String, locale)}
	}
	for _, slug := range rev.Tags {
		detail.Tags = append(detail.Tags, Ref{Slug: slug, Name: s.tagName(ctx, slug, locale)})
	}
	if detail.Tags == nil {
		detail.Tags = []Ref{}
	}
	detail.OutboundAllowed = game.LinkStatus == "valid" && !game.OutboundDisabled
	if !detail.OutboundAllowed {
		reason := "link_unavailable"
		detail.OutboundBlockedReason = &reason
	}
	if game.FirstPublishedAt != nil {
		detail.FirstPublishedAt = game.FirstPublishedAt.Format(time.RFC3339)
	}
	detail.PublishedAt = detail.FirstPublishedAt
	return detail, nil
}

// relatedForRevision computes related games using the revision's category and
// tags (the preview candidate), over the public read model (§4.5).
func (s *Service) relatedForRevision(ctx context.Context, rev sqlc.GameRevision, locale string) ([]GameCard, error) {
	category := ""
	if rev.PrimaryCategory.Valid {
		category = rev.PrimaryCategory.String
	}
	if category == "" || len(rev.Tags) == 0 {
		return []GameCard{}, nil
	}
	related, err := s.Q.ListRelatedGames(ctx, sqlc.ListRelatedGamesParams{
		Locale: locale, Category: category, Tags: rev.Tags,
	})
	if err != nil {
		return nil, err
	}
	return s.GameCardsForRows(ctx, related, locale)
}

func (s *Service) categoryName(ctx context.Context, slug, locale string) string {
	row, err := s.Q.GetCategory(ctx, slug)
	if err != nil {
		return slug
	}
	if n := parseNames(row.Names)[locale]; n != "" {
		return n
	}
	return slug
}

func (s *Service) tagName(ctx context.Context, slug, locale string) string {
	row, err := s.Q.GetTag(ctx, slug)
	if err != nil {
		return slug
	}
	if n := parseNames(row.Names)[locale]; n != "" {
		return n
	}
	return slug
}
