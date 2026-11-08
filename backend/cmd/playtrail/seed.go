package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"playtrail/backend/internal/catalog"
	"playtrail/backend/internal/clock"
	"playtrail/backend/internal/httpx"
	"playtrail/backend/internal/media"
)

// seedPack is the content-pack format: PRD 09 import rows plus per-game
// publishing directives (featured, editorialOrder, linkStatus, device
// support, publish with locales to approve).
type seedPack struct {
	SchemaVersion int            `json:"schemaVersion"`
	Games         []seedPackGame `json:"games"`
}

type seedPackGame struct {
	catalog.CreateInput
	Developer         string                    `json:"developer"`
	CoverSourcePath   string                    `json:"coverSourcePath"`
	Featured          *bool                     `json:"featured"`
	EditorialOrder    *int                      `json:"editorialOrder"`
	LinkStatus        string                    `json:"linkStatus"`
	DeviceSupport     string                    `json:"deviceSupport"`
	DeviceEvidenceURL string                    `json:"deviceEvidenceUrl"`
	Publish           bool                      `json:"publish"`
	Locales           map[string]seedPackLocale `json:"locales"`
}

type seedPackLocale struct {
	Alias       *string `json:"alias"`
	Summary     *string `json:"summary"`
	Description *string `json:"description"`
	Controls    *string `json:"controls"`
}

// runSeed loads a content pack for dev/e2e through the real domain functions
// (create → patch → link-check → review → publish) acting as actor 'system',
// so all publish gates apply. Rows failing gates are reported and skipped.
func runSeed(ctx context.Context) error {
	fs := flag.NewFlagSet("seed", flag.ContinueOnError)
	file := fs.String("file", "", "content pack JSON file (required)")
	if err := fs.Parse(os.Args[2:]); err != nil {
		return err
	}
	if *file == "" {
		return errors.New("--file is required")
	}
	raw, err := os.ReadFile(*file)
	if err != nil {
		return err
	}
	var pack seedPack
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&pack); err != nil {
		return fmt.Errorf("parse content pack: %w", err)
	}

	cfg, err := loadConfig(false)
	if err != nil {
		return err
	}
	pool, err := dbOpen(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	clk := buildClock()
	mediaSvc := &media.Service{Dir: cfg.MediaDir, BaseURL: cfg.PublicBaseURL}
	cat := catalog.NewService(pool, clk, mediaSvc, cfg.PublicBaseURL, cfg.SupportedLocales, cfg.DefaultLocale, cfg.LocaleMinGames, cfg.ExternalCoversEnabled, nil)

	actor := "system"
	failed, written := 0, 0
	for i, g := range pack.Games {
		if err := seedOneGame(ctx, cat, clk, g, actor); err != nil {
			failed++
			fmt.Fprintf(os.Stderr, "row %d (%s): %v\n", i+1, g.Name, describeErr(err))
			continue
		}
		written++
		fmt.Fprintf(os.Stderr, "row %d (%s): done\n", i+1, g.Name)
	}
	// Rows that did publish must be visible to the web without a manual
	// revalidate call — even when other rows failed (B10).
	if written > 0 {
		cacheInvalidator(cfg).NotifySync("games", "hot", "dict")
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d rows failed gates", failed, len(pack.Games))
	}
	return nil
}

// describeErr exposes validation field errors for the seed report.
func describeErr(err error) string {
	var apiErr *httpx.Error
	if errors.As(err, &apiErr) && len(apiErr.FieldErrors) > 0 {
		return fmt.Sprintf("%s %v", apiErr.Code, apiErr.FieldErrors)
	}
	return err.Error()
}

// seedOneGame drives one pack row through the full lifecycle.
func seedOneGame(ctx context.Context, cat *catalog.Service, clk clock.Clock, g seedPackGame, actor string) error {
	game, err := cat.CreateGame(ctx, g.CreateInput, actor, nil)
	if err != nil {
		return fmt.Errorf("create: %w", err)
	}

	// PATCH: shared fields + locale content through the real domain function.
	in := catalog.PatchInput{
		RevisionVersion: game.RevisionVersion,
		Locales:         map[string]catalog.LocalePatch{},
	}
	if g.Developer != "" {
		dev := g.Developer
		in.Developer = &dev
	}
	if g.Featured != nil {
		in.Featured = g.Featured
	}
	if g.EditorialOrder != nil {
		in.EditorialOrder = g.EditorialOrder
	}
	if g.CoverSourcePath != "" {
		csp := g.CoverSourcePath
		in.CoverSourcePath = &csp
	}
	if g.DeviceSupport != "" {
		ds := g.DeviceSupport
		in.DeviceSupport = &ds
	}
	if g.DeviceEvidenceURL != "" {
		de := g.DeviceEvidenceURL
		in.DeviceEvidenceURL = &de
		dc := clk.Now().Format("2006-01-02T15:04:05Z07:00")
		in.DeviceCheckedAt = &dc
	}
	for locale, l := range g.Locales {
		in.Locales[locale] = catalog.LocalePatch{
			Alias:       l.Alias,
			Summary:     l.Summary,
			Description: l.Description,
			Controls:    l.Controls,
		}
	}
	game, err = cat.PatchGame(ctx, game.ID, in, nil)
	if err != nil {
		return fmt.Errorf("patch: %w", err)
	}

	// Link check: the pack vouches for the link (dev/e2e data only).
	if g.LinkStatus != "" {
		game, err = cat.LinkCheck(ctx, game.ID, catalog.LinkCheckInput{Status: g.LinkStatus, Note: "seed content pack"}, nil)
		if err != nil {
			return fmt.Errorf("link-check: %w", err)
		}
	}

	if !g.Publish {
		return nil
	}

	// Review each listed locale with explicit confirmations, then publish.
	for locale := range g.Locales {
		game, err = cat.ReviewLocale(ctx, game.ID, locale, catalog.ReviewInput{
			RevisionVersion:      game.RevisionVersion,
			Decision:             "approved",
			ConfirmOriginal:      true,
			ConfirmFactsVerified: true,
		}, nil)
		if err != nil {
			return fmt.Errorf("review %s: %w", locale, err)
		}
	}
	locales := make([]string, 0, len(g.Locales))
	for locale := range g.Locales {
		locales = append(locales, locale)
	}
	_, err = cat.Publish(ctx, game.ID, catalog.PublishInput{
		RevisionVersion: game.RevisionVersion,
		Locales:         locales,
	}, nil)
	if err != nil {
		return fmt.Errorf("publish: %w", err)
	}
	return nil
}
