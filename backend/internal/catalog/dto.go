// Package catalog implements game lifecycle (ARCHITECTURE §4): revisions,
// publish gates, the public_games read model, related games, and the public
// read endpoints' data assembly.
package catalog

import (
	"encoding/json"

	"github.com/google/uuid"

	"playtrail/backend/internal/media"
)

// Ref is a dictionary reference with the display name in the request locale.
type Ref struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// GateFailure is one failed gate check.
type GateFailure struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// GateCheck is the result of a group of gate checks.
type GateCheck struct {
	OK       bool          `json:"ok"`
	Failures []GateFailure `json:"failures"`
}

// GateReport is the publish gate report (ARCHITECTURE §6.3).
type GateReport struct {
	Game    GateCheck            `json:"game"`
	Locales map[string]GateCheck `json:"locales"`
}

// GameCard is the public card shape (§6.1).
type GameCard struct {
	ID              uuid.UUID    `json:"id"`
	Slug            string       `json:"slug"`
	Name            string       `json:"name"`
	Alias           string       `json:"alias"`
	Summary         string       `json:"summary"`
	PrimaryCategory Ref          `json:"primaryCategory"`
	Tags            []Ref        `json:"tags"`
	Cover           *media.Image `json:"cover"`
	OutboundAllowed bool         `json:"outboundAllowed"`
}

// GameDetail is the public detail shape (§6.1).
type GameDetail struct {
	GameCard
	Description           string          `json:"description"`
	Controls              string          `json:"controls"`
	Developer             string          `json:"developer"`
	DeviceSupport         string          `json:"deviceSupport"`
	DeviceEvidence        *DeviceEvidence `json:"deviceEvidence"`
	SourceURL             string          `json:"sourceUrl"`
	SourceFetchedAt       string          `json:"sourceFetchedAt"`
	Screenshots           []media.Image   `json:"screenshots"`
	CTAURL                string          `json:"ctaUrl"`
	OutboundBlockedReason *string         `json:"outboundBlockedReason"`
	AvailableLocales      []string        `json:"availableLocales"`
	FirstPublishedAt      string          `json:"firstPublishedAt"`
	PublishedAt           string          `json:"publishedAt"`
	Related               []GameCard      `json:"related"`
}

// DeviceEvidence marks verified device support.
type DeviceEvidence struct {
	URL       string `json:"url"`
	CheckedAt string `json:"checkedAt"`
}

// GameList is the public list response (§6.2).
type GameList struct {
	Items          []GameCard    `json:"items"`
	Total          int           `json:"total"`
	Page           int           `json:"page"`
	PageSize       int           `json:"pageSize"`
	TotalPages     int           `json:"totalPages"`
	AppliedFilters AppliedFilter `json:"appliedFilters"`
}

// AppliedFilter echoes the filters actually applied.
type AppliedFilter struct {
	Q        *string `json:"q"`
	Category *string `json:"category"`
	Tag      *string `json:"tag"`
	Sort     string  `json:"sort"`
}

// Meta is the /api/meta response (§6.2).
type Meta struct {
	SupportedLocales []string `json:"supportedLocales"`
	LiveLocales      []string `json:"liveLocales"`
	DefaultLocale    string   `json:"defaultLocale"`
}

// AdminGameLocale is one locale's admin state (§6.3).
type AdminGameLocale struct {
	Alias             string            `json:"alias"`
	Summary           string            `json:"summary"`
	Description       string            `json:"description"`
	Controls          string            `json:"controls"`
	MediaAlt          map[string]string `json:"mediaAlt"`
	ContentReview     string            `json:"contentReview"`
	TranslationMethod string            `json:"translationMethod"`
	ReviewedAt        *string           `json:"reviewedAt"`
	Live              bool              `json:"live"`
	LiveRevisionID    *uuid.UUID        `json:"liveRevisionId"`
	FirstPublishedAt  *string           `json:"firstPublishedAt"`
	PublishedAt       *string           `json:"publishedAt"`
}

// AdminGame is the admin game detail shape (§6.3): games operations fields +
// the candidate revision's shared fields + per-locale state.
type AdminGame struct {
	ID                     uuid.UUID                  `json:"id"`
	Slug                   string                     `json:"slug"`
	Platform               string                     `json:"platform"`
	ExternalURL            string                     `json:"externalUrl"`
	Status                 string                     `json:"status"`
	StatusReason           string                     `json:"statusReason"`
	LinkStatus             string                     `json:"linkStatus"`
	LinkCheckedAt          *string                    `json:"linkCheckedAt"`
	LinkCheckMethod        string                     `json:"linkCheckMethod"`
	LinkCheckNote          string                     `json:"linkCheckNote"`
	OutboundDisabled       bool                       `json:"outboundDisabled"`
	OutboundDisabledReason string                     `json:"outboundDisabledReason"`
	Featured               bool                       `json:"featured"`
	EditorialOrder         int                        `json:"editorialOrder"`
	RevisionVersion        int                        `json:"revisionVersion"`
	FirstPublishedAt       *string                    `json:"firstPublishedAt"`
	CreatedAt              string                     `json:"createdAt"`
	UpdatedAt              string                     `json:"updatedAt"`
	Name                   string                     `json:"name"`
	Developer              string                     `json:"developer"`
	PrimaryCategory        *string                    `json:"primaryCategory"`
	Tags                   []string                   `json:"tags"`
	DeviceSupport          string                     `json:"deviceSupport"`
	DeviceEvidenceURL      string                     `json:"deviceEvidenceUrl"`
	DeviceCheckedAt        *string                    `json:"deviceCheckedAt"`
	SourceURL              string                     `json:"sourceUrl"`
	SourceFetchedAt        string                     `json:"sourceFetchedAt"`
	CoverAssetID           *uuid.UUID                 `json:"coverAssetId"`
	CoverSourcePath        string                     `json:"coverSourcePath"`
	ScreenshotAssetIDs     []uuid.UUID                `json:"screenshotAssetIds"`
	UsePlaceholder         bool                       `json:"usePlaceholder"`
	MaterialReview         string                     `json:"materialReview"`
	Locales                map[string]AdminGameLocale `json:"locales"`
	HasPendingChanges      bool                       `json:"hasPendingChanges"`
	Gates                  GateReport                 `json:"gates"`
	Source                 *AdminGameSource           `json:"source"`
}

// AdminGameSource links a game to its crawler source record.
type AdminGameSource struct {
	SourceGameID    uuid.UUID `json:"sourceGameId"`
	LastFetchedAt   *string   `json:"lastFetchedAt"`
	LastFetchResult string    `json:"lastFetchResult"`
}

// AdminGameLocalesState is the per-locale summary in admin list rows.
type AdminGameLocalesState struct {
	ContentReview string `json:"contentReview"`
	Live          bool   `json:"live"`
}

// AdminGameRow is one row of the admin game list (§6.3).
type AdminGameRow struct {
	ID               uuid.UUID                        `json:"id"`
	Slug             string                           `json:"slug"`
	Name             string                           `json:"name"`
	Status           string                           `json:"status"`
	LinkStatus       string                           `json:"linkStatus"`
	OutboundDisabled bool                             `json:"outboundDisabled"`
	Featured         bool                             `json:"featured"`
	EditorialOrder   int                              `json:"editorialOrder"`
	UpdatedAt        string                           `json:"updatedAt"`
	SourceFetchedAt  string                           `json:"sourceFetchedAt"`
	LinkCheckedAt    *string                          `json:"linkCheckedAt"`
	Locales          map[string]AdminGameLocalesState `json:"locales"`
	Risks            []string                         `json:"risks"`
}

func parseNames(raw []byte) map[string]string {
	m := map[string]string{}
	_ = json.Unmarshal(raw, &m)
	return m
}
