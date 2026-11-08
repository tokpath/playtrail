package crawler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	sqlc "playtrail/backend/internal/db/sqlc"
)

const sitemapPath = "/en/sitemap"

// runTaskBody dispatches to the four task implementations (PRD 22.3).
func (s *Service) runTaskBody(ctx context.Context, run *Run, task string) error {
	switch task {
	case "sitemap":
		return s.sitemapTask(ctx, run)
	case "tracked":
		return s.trackedTask(ctx, run)
	case "backfill":
		return s.backfillTask(ctx, run)
	case "hot":
		return s.hotTask(ctx, run)
	}
	return fmt.Errorf("unknown task %q", task)
}

// sitemapTask: robots + English sitemap; new slugs join the source catalog,
// missing collected games count toward the "suspect gone" flag and get an
// immediate detail check (PRD 22.3, 22.7).
func (s *Service) sitemapTask(ctx context.Context, run *Run) error {
	resp, err := run.fetch(sitemapPath)
	if err != nil {
		run.statuses["timeout"]++
		return err
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("sitemap HTTP %d", resp.StatusCode)
	}

	newCount, seenCount := 0, 0
	seen := map[string]bool{}
	err = SitemapIter(strings.NewReader(string(resp.Body)), func(entry SitemapEntry) error {
		if run.aborted {
			return ErrAborted
		}
		seen[entry.Slug] = true
		row, err := s.Q.UpsertSourceGameFromSitemap(ctx, sqlc.UpsertSourceGameFromSitemapParams{
			Slug: entry.Slug, LocaleUrls: marshalJSON(entry.LocaleURLs), Now: ptrTime(s.Clock.Now()),
		})
		if err != nil {
			return err
		}
		if row.Inserted {
			newCount++
		} else {
			seenCount++
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrAborted) {
			return err
		}
		return fmt.Errorf("sitemap parse: %w", err)
	}

	// Collected games that vanished from the sitemap: count misses; at the
	// 3rd consecutive miss flag + immediate detail check (PRD 22.7).
	var missing []uuid.UUID
	collected, err := s.Q.ListCollectedSourceGames(ctx)
	if err != nil {
		return err
	}
	for _, sg := range collected {
		if seen[sg.Slug] || run.aborted {
			continue
		}
		count, err := s.Q.MarkSourceGameSitemapMissing(ctx, sg.Slug)
		if err != nil {
			return err
		}
		if count >= 3 {
			missing = append(missing, sg.ID)
		}
	}
	detailChecked := 0
	for _, id := range missing {
		if run.aborted {
			break
		}
		if err := s.checkSourceGameDetail(ctx, run, id); err != nil {
			return err
		}
		detailChecked++
	}

	// 22.5: link source rows to games that exist by external URL.
	if _, err := s.Q.LinkSourceGamesByExternalURL(ctx); err != nil {
		return err
	}

	run.stats["new"] = newCount
	run.stats["seen"] = seenCount
	run.stats["missingFlagged"] = len(missing)
	run.stats["detailChecked"] = detailChecked
	return nil
}

// trackedTask: fetch each collected game's page; refresh link checks, set
// suspect per 22.7, record content changes as source_changes — never editing
// published content.
func (s *Service) trackedTask(ctx context.Context, run *Run) error {
	collected, err := s.Q.ListCollectedSourceGames(ctx)
	if err != nil {
		return err
	}
	var suspects, unchanged, changed, failures int
	for _, sg := range collected {
		if run.aborted {
			return ErrAborted
		}
		if err := s.checkSourceGameDetail(ctx, run, sg.ID); err != nil {
			if errors.Is(err, ErrQuotaExceeded) || errors.Is(err, ErrAborted) {
				return err
			}
			failures++
			continue
		}
		fresh, err := s.Q.GetSourceGame(ctx, sg.ID)
		if err != nil {
			return err
		}
		switch fresh.LastFetchResult {
		case "ok":
			unchanged++
		case "parse_error", "error":
			failures++
		default:
			// not_found / unpublished / redirected: suspect handling happens
			// inside checkSourceGameDetail; count here for the stats.
			suspects++
		}
		if s.hasPendingChanges(ctx, *sg.GameID) {
			changed++
		}
	}
	run.stats["collected"] = len(collected)
	run.stats["ok"] = unchanged
	run.stats["suspects"] = suspects
	run.stats["changed"] = changed
	run.stats["failures"] = failures
	return nil
}

// hasPendingChanges checks for pending source_changes of a collected game.
func (s *Service) hasPendingChanges(ctx context.Context, gameID uuid.UUID) bool {
	counts, err := s.Q.CountPendingSourceChangesForGame(ctx, gameID)
	if err != nil {
		return false
	}
	return counts > 0
}

// backfillTask: fetch details for source games that lack them, then refresh
// details older than 30 days, within the remaining quota (PRD 22.3).
func (s *Service) backfillTask(ctx context.Context, run *Run) error {
	candidates, err := s.Q.ListSourceGamesForDetail(ctx, sqlc.ListSourceGamesForDetailParams{
		RefreshBefore: ptrTime(s.Clock.Now().AddDate(0, 0, -30)),
		RowLimit:      1000,
	})
	if err != nil {
		return err
	}
	detailCount := 0
	quotaOut := false
	for _, sg := range candidates {
		if run.aborted {
			return ErrAborted
		}
		if err := s.checkSourceGameDetail(ctx, run, sg.ID); err != nil {
			if errors.Is(err, ErrQuotaExceeded) || errors.Is(err, ErrAborted) {
				quotaOut = errors.Is(err, ErrQuotaExceeded)
				break
			}
			return err
		}
		detailCount++
	}
	run.stats["candidates"] = len(candidates)
	run.stats["detailed"] = detailCount
	// A quota-truncated run is still clean for the breaker, but the outcome
	// must say partial (PRD 22.3/22.4.2).
	if quotaOut {
		return ErrQuotaExceeded
	}
	return nil
}

// hotTask: fetch /hot, take the first 20 slugs in page order, and create a
// snapshot batch; auto-publish per crawler_settings (PRD 22.9).
func (s *Service) hotTask(ctx context.Context, run *Run) error {
	resp, err := run.fetch("/hot")
	if err != nil {
		return err
	}
	items, err := ParseHotPage(resp.Body)
	if err != nil {
		return fmt.Errorf("hot parse: %w", err)
	}
	settings, err := s.Q.GetCrawlerSettings(ctx)
	if err != nil {
		return err
	}
	// 22.5: mapping resolves through source_games.game_id / external URL,
	// never through our own slug — refresh the links first.
	if _, err := s.Q.LinkSourceGamesByExternalURL(ctx); err != nil {
		return err
	}
	var inputs []HotItemInput
	for i, it := range items {
		inputs = append(inputs, HotItemInput{Position: i + 1, Slug: it.Slug})
	}
	snapshotID, mapped, err := s.Hot.CreateFromCrawler(ctx, HotSnapshotInput{
		SourceURL:      defaultBaseURL + "/hot",
		FetchedAt:      s.Clock.Now(),
		ObservedRegion: s.Cfg.CrawlerObservedRegion,
		Definition:     "CrazyGames /hot — past 24 hours rising, page order, first 20",
		Items:          inputs,
		AutoPublish:    settings.HotAutoPublish,
	})
	if err != nil {
		return err
	}
	run.stats["items"] = len(inputs)
	run.stats["mapped"] = mapped
	run.stats["snapshotId"] = snapshotID.String()
	if s.Notify != nil {
		s.Notify("hot")
	}
	return nil
}

// checkSourceGameDetail fetches and stores one game page's detail, applying
// the PRD 22.6/22.7 rules: mapping, change detection, link-status handling.
func (s *Service) checkSourceGameDetail(ctx context.Context, run *Run, sourceID uuid.UUID) error {
	sg, err := s.Q.GetSourceGame(ctx, sourceID)
	if err != nil {
		return err
	}
	now := s.Clock.Now()
	path := "/game/" + sg.Slug

	resp, err := run.fetch(path)
	if err != nil {
		if errors.Is(err, ErrQuotaExceeded) || errors.Is(err, ErrAborted) || errors.Is(err, ErrDisallowed) {
			return err
		}
		// Network failure / cross-host redirect: no link-status change
		// (22.7 row 3), count the failure day.
		result := "error"
		if errors.Is(err, ErrCrossHostRedirect) {
			result = "redirected"
		}
		if err := s.Q.SetSourceGameFetchFailure(ctx, sqlc.SetSourceGameFetchFailureParams{
			ID: sg.ID, LastFetchedAt: ptrTime(now), LastFetchResult: result, PreviousFetch: pgTimePtr(sg.LastFetchedAt),
		}); err != nil {
			return err
		}
		if sg.GameID != nil && result == "redirected" {
			if err := s.markSuspect(ctx, *sg.GameID, "cross-host redirect refused"); err != nil {
				return err
			}
		}
		return nil
	}
	if resp.StatusCode == 304 {
		// The service retains conditional validators between runs. No body
		// changed, so refresh only the link-check time, never content.
		if sg.GameID != nil {
			if err := s.Q.SetSourceGameLinkRefresh(ctx, sqlc.SetSourceGameLinkRefreshParams{GameID: *sg.GameID, CheckedAt: ptrTime(now)}); err != nil {
				return err
			}
			return s.Catalog.RebuildPublicGameTx(ctx, *sg.GameID)
		}
		return nil
	}
	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		if err := s.Q.SetSourceGameFetchFailure(ctx, sqlc.SetSourceGameFetchFailureParams{
			ID: sg.ID, LastFetchedAt: ptrTime(now), LastFetchResult: "not_found", PreviousFetch: pgTimePtr(sg.LastFetchedAt),
		}); err != nil {
			return err
		}
		if sg.GameID != nil {
			if err := s.markSuspect(ctx, *sg.GameID, fmt.Sprintf("HTTP %d at %s", resp.StatusCode, path)); err != nil {
				return err
			}
		}
		return nil
	}
	if resp.StatusCode != 200 {
		if err := s.Q.SetSourceGameFetchFailure(ctx, sqlc.SetSourceGameFetchFailureParams{
			ID: sg.ID, LastFetchedAt: ptrTime(now), LastFetchResult: "error", PreviousFetch: pgTimePtr(sg.LastFetchedAt),
		}); err != nil {
			return err
		}
		return nil
	}

	run.parseAttempts++
	game, full, err := ParseGamePage(resp.Body)
	if err != nil || !full {
		run.parseFailures++
		if err := s.Q.SetSourceGameFetchFailure(ctx, sqlc.SetSourceGameFetchFailureParams{
			ID: sg.ID, LastFetchedAt: ptrTime(now), LastFetchResult: "parse_error", PreviousFetch: pgTimePtr(sg.LastFetchedAt),
		}); err != nil {
			return err
		}
		return nil
	}

	// 22.7 row 2: unpublished status or canonical/slug mismatch → suspect.
	if sg.GameID != nil && (game.Status != "PUBLISHED" || game.Slug != sg.Slug ||
		(game.CanonicalURL != "" && game.CanonicalURL != CanonicalURL(sg.Slug))) {
		if err := s.Q.SetSourceGameFetchFailure(ctx, sqlc.SetSourceGameFetchFailureParams{
			ID: sg.ID, LastFetchedAt: ptrTime(now), LastFetchResult: "unpublished", PreviousFetch: pgTimePtr(sg.LastFetchedAt),
		}); err != nil {
			return err
		}
		if err := s.markSuspect(ctx, *sg.GameID, "status="+game.Status+" slug mismatch="+game.Slug); err != nil {
			return err
		}
		return nil
	}

	if err := s.storeDetail(ctx, sg, game, full, now); err != nil {
		return err
	}
	// 22.5: a backfilled detail may match a game created meanwhile.
	if _, err := s.Q.LinkSourceGamesByExternalURL(ctx); err != nil {
		return err
	}

	// 22.7 row 1: refresh the link check; a currently valid game stays
	// valid, an unchecked game still needs manual confirmation first.
	if sg.GameID != nil {
		if err := s.Q.SetSourceGameLinkRefresh(ctx, sqlc.SetSourceGameLinkRefreshParams{
			GameID: *sg.GameID, CheckedAt: ptrTime(now),
		}); err != nil {
			return err
		}
		if err := s.Catalog.RebuildPublicGameTx(ctx, *sg.GameID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
	}
	return nil
}

// markSuspect sets link_status=suspect and rebuilds the public rows so the
// CTA is disabled immediately (PRD 22.7 row 2).
func (s *Service) markSuspect(ctx context.Context, gameID uuid.UUID, note string) error {
	now := s.Clock.Now()
	if err := s.Q.SetGameSuspectByCrawler(ctx, sqlc.SetGameSuspectByCrawlerParams{
		GameID: gameID, Note: note, CheckedAt: ptrTime(now),
	}); err != nil {
		return err
	}
	if err := s.Catalog.RebuildPublicGameTx(ctx, gameID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if s.Notify != nil {
		s.Notify("games")
	}
	s.Log.Warn("source game suspect", "gameId", gameID, "note", note)
	return nil
}

// storeDetail upserts the whitelisted fields into source_games and records
// content changes for collected games as pending source_changes (22.6, 22.7).
func (s *Service) storeDetail(ctx context.Context, sg sqlc.SourceGame, game *CGGame, full bool, now time.Time) error {
	tags := marshalJSON(sourceTags(game))
	deviceFlags := marshalJSON(map[string]any{
		"ios": game.IosFriendly, "android": game.AndroidFriendly,
	})
	// 22.6: reference material is stored as plain text, never the raw HTML
	// markup (copyrighted CG content); plain text is what editors fact-check.
	reference := marshalJSON(map[string]any{
		"descriptionFirst":  plainText(game.DescriptionFirst),
		"metaDescription":   plainText(game.MetaDescription),
		"lastFileUpdatedOn": game.LastFileUpdatedOn,
		"descriptionRest":   plainText(game.DescriptionRest),
		"controls":          plainText(game.Controls),
		"faq":               faqPlainText(game.Faq),
	})
	raw := marshalJSON(game)
	hash := contentHash(game)

	var rating pgtype.Numeric
	if game.Rating != nil {
		if err := rating.ScanScientific(fmt.Sprint(*game.Rating)); err != nil {
			rating = pgtype.Numeric{}
		}
	}
	var upvotes, downvotes pgtype.Int8
	if game.Upvotes != nil {
		upvotes = pgtype.Int8{Int64: *game.Upvotes, Valid: true}
	}
	if game.Downvotes != nil {
		downvotes = pgtype.Int8{Int64: *game.Downvotes, Valid: true}
	}

	parserVersion := int32(1)
	if !full {
		parserVersion = sg.ParserVersion
	}

	updated, err := s.Q.UpsertSourceGameDetail(ctx, sqlc.UpsertSourceGameDetailParams{
		ID:                       sg.ID,
		SourceID:                 pgTextOpt(game.ID),
		Name:                     game.Name,
		CategorySlug:             game.Category.EnSlug,
		Tags:                     tags,
		Developer:                game.Developer,
		DeviceFlags:              deviceFlags,
		IsMultiplayer:            pgBoolOpt(game.MultiplayerOptions.IsMultiplayer),
		AddedOn:                  pgDateOpt(game.AddedOn),
		LastSignificantUpdatedOn: pgDateOpt(game.LastSignificantUpdatedOn),
		SourceStatus:             game.Status,
		Rating:                   rating,
		Upvotes:                  upvotes,
		Downvotes:                downvotes,
		CoverPath:                game.Cover,
		Reference:                reference,
		Raw:                      raw,
		RawExpiresAt:             ptrTime(now.AddDate(0, 0, 30)),
		ContentHash:              hash,
		ParserVersion:            int32(parserVersion),
		LastFetchedAt:            ptrTime(now),
		LastFetchResult:          "ok",
	})
	if err != nil {
		return err
	}
	_ = updated

	// Change detection only for collected games; record diffs, never edit
	// published content (PRD 22.7 row 4).
	if sg.GameID != nil && sg.ParserVersion > 0 && sg.ContentHash != "" && sg.ContentHash != hash {
		if err := s.recordChanges(ctx, sg, game); err != nil {
			return err
		}
	}
	return nil
}

// sourceTags extracts the mapped-eligible CG tag slugs; multiplayer from
// multiplayerOptions rides along (PRD 22.6).
func sourceTags(game *CGGame) []string {
	seen := map[string]bool{}
	var out []string
	add := func(slug string) {
		if slug != "" && !seen[slug] {
			seen[slug] = true
			out = append(out, slug)
		}
	}
	for _, t := range game.Tags {
		add(t.EnSlug)
	}
	if game.MultiplayerOptions.IsMultiplayer {
		add("multiplayer")
	}
	return out
}

// recordChanges diffs name/category/tags/developer/device against the
// previously stored source record.
func (s *Service) recordChanges(ctx context.Context, sg sqlc.SourceGame, game *CGGame) error {
	// Compare against the stored normalized columns from the previous fetch.
	type fieldDiff struct {
		field string
		oldV  []byte
		newV  []byte
	}
	var diffs []fieldDiff
	if sg.Name != "" && sg.Name != game.Name {
		diffs = append(diffs, fieldDiff{"name", marshalJSON(sg.Name), marshalJSON(game.Name)})
	}
	if sg.CategorySlug != "" && sg.CategorySlug != game.Category.EnSlug {
		diffs = append(diffs, fieldDiff{"primary_category", marshalJSON(sg.CategorySlug), marshalJSON(game.Category.EnSlug)})
	}
	if oldTags := sourceTagsFromJSON(sg.Tags); !equalStrings(oldTags, sourceTags(game)) {
		diffs = append(diffs, fieldDiff{"tags", marshalJSON(oldTags), marshalJSON(sourceTags(game))})
	}
	if sg.Developer != "" && sg.Developer != game.Developer {
		diffs = append(diffs, fieldDiff{"developer", marshalJSON(sg.Developer), marshalJSON(game.Developer)})
	}
	if !equalDeviceFlags(sg.DeviceFlags, game) {
		diffs = append(diffs, fieldDiff{"device_flags", sg.DeviceFlags, deviceFlagsJSON(game)})
	}
	for _, d := range diffs {
		// One pending change per field per game (avoid duplicates).
		exists, err := s.Q.HasUnresolvedSourceChange(ctx, sqlc.HasUnresolvedSourceChangeParams{
			GameID: *sg.GameID, Field: d.field,
		})
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if err := s.Q.InsertSourceChange(ctx, sqlc.InsertSourceChangeParams{
			GameID: *sg.GameID, Field: d.field,
			OldValue: d.oldV, NewValue: d.newV,
		}); err != nil {
			return err
		}
	}
	return nil
}

// faqPlainText converts the CG faq array to plain-text answers, keeping the
// questions verbatim.
func faqPlainText(raw json.RawMessage) []map[string]string {
	var entries []struct {
		Q string `json:"q"`
		A string `json:"a"`
	}
	if err := json.Unmarshal(raw, &entries); err != nil {
		return []map[string]string{}
	}
	out := make([]map[string]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, map[string]string{"q": e.Q, "a": plainText(e.A)})
	}
	return out
}

func sourceTagsFromJSON(raw []byte) []string {
	var tags []string
	_ = json.Unmarshal(raw, &tags)
	return tags
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func equalDeviceFlags(raw []byte, game *CGGame) bool {
	var stored map[string]bool
	_ = json.Unmarshal(raw, &stored)
	return stored["ios"] == game.IosFriendly && stored["android"] == game.AndroidFriendly
}

func deviceFlagsJSON(game *CGGame) []byte {
	return marshalJSON(map[string]any{"ios": game.IosFriendly, "android": game.AndroidFriendly})
}

func contentHash(game *CGGame) string {
	h := game.Name + "|" + game.Category.EnSlug + "|" +
		strings.Join(sourceTags(game), ",") + "|" + game.Developer + "|" +
		fmt.Sprint(game.IosFriendly) + fmt.Sprint(game.AndroidFriendly)
	return shortHash(h)
}
