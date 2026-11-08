package crawler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/temoto/robotstxt"

	"playtrail/backend/internal/clock"
	"playtrail/backend/internal/config"
	sqlc "playtrail/backend/internal/db/sqlc"
)

// Service runs one crawler task at a time with the PRD 22 discipline.
type Service struct {
	Pool  *pgxpool.Pool
	Q     *sqlc.Queries
	Clock clock.Clock
	Cfg   *config.Config
	Hot   HotWriter
	// Catalog is used by collect and by tracked-game suspect rebuilds.
	Catalog Catalog
	Notify  func(tags ...string)
	Log     *slog.Logger
	client  *Client // reused between runs for conditional-request validators
}

// HotWriter is the hot-snapshot surface the crawler needs.
type HotWriter interface {
	CreateFromCrawler(ctx context.Context, in HotSnapshotInput) (uuid.UUID, int, error)
}

// Catalog is the catalog surface the crawler needs (suspect rebuild).
type Catalog interface {
	RebuildPublicGameTx(ctx context.Context, gameID uuid.UUID) error
}

// HotItemInput is one hot entry before game mapping.
type HotItemInput struct {
	Position int
	Slug     string
}

// HotSnapshotInput is a crawler-generated batch (PRD 22.9).
type HotSnapshotInput struct {
	SourceURL      string
	FetchedAt      time.Time
	ObservedRegion string
	Definition     string
	Items          []HotItemInput
	AutoPublish    bool
}

// Run carries the state of one task run.
type Run struct {
	svc           *Service
	ctx           context.Context
	client        *Client
	robot         *robotstxt.Group
	runID         uuid.UUID
	requests      int
	statuses      map[string]int
	stats         map[string]any
	aborted       bool
	abortWhy      string
	parseAttempts int
	parseFailures int
}

// Run errors.
var (
	ErrDisabledByEnv = errors.New("crawler disabled by CRAWLER_ENABLED=false")
	ErrPaused        = errors.New("crawler paused in crawler_settings")
	ErrAutoDisabled  = errors.New("crawler auto-disabled after repeated aborts")
	ErrBusy          = errors.New("another crawl is already running for this task")
	ErrQuotaExceeded = errors.New("daily request quota exhausted")
	ErrDisallowed    = errors.New("path disallowed by robots.txt")
	ErrAborted       = errors.New("run aborted")
)

var taskPattern = regexp.MustCompile(`^(sitemap|tracked|backfill|hot)$`)

// ValidTask reports whether task is one of the four scheduled tasks.
func ValidTask(task string) bool { return taskPattern.MatchString(task) }

// count records one response status.
func (r *Run) count(status string) { r.statuses[status]++ }

// RunTask executes one task end to end: switches, advisory lock, robots,
// the task body, breaker accounting, and the sync_runs record.
func (s *Service) RunTask(ctx context.Context, task string) (*sqlc.SyncRun, error) {
	// Refuse before any request is made (e2e: CRAWLER_BASE_URL guard, C5).
	if err := validateBaseURL(); err != nil {
		return nil, err
	}
	if !ValidTask(task) {
		return nil, fmt.Errorf("unknown task %q", task)
	}
	if !s.Cfg.CrawlerEnabled {
		return nil, ErrDisabledByEnv
	}
	settings, err := s.Q.GetCrawlerSettings(ctx)
	if err != nil {
		return nil, err
	}
	if settings.AutoDisabled {
		return nil, ErrAutoDisabled
	}
	if !settings.Enabled {
		return nil, ErrPaused
	}

	// A dedicated connection owns the advisory lock until this run ends.
	// All tasks share it: per-task locks would multiply host parallelism.
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	var locked bool
	const lockKey = "crawler"
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtext($1))", lockKey).Scan(&locked); err != nil {
		return nil, err
	}
	if !locked {
		return nil, ErrBusy
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = conn.Exec(cleanup, "SELECT pg_advisory_unlock(hashtext($1))", lockKey)
	}()
	// Read settings under the same lock so the abort streak cannot be stale.
	settings, err = s.Q.GetCrawlerSettings(ctx)
	if err != nil {
		return nil, err
	}
	if settings.AutoDisabled {
		return nil, ErrAutoDisabled
	}
	if !settings.Enabled {
		return nil, ErrPaused
	}

	if s.client == nil {
		s.client = NewClient(s.Cfg.CrawlerUserAgent, time.Duration(settings.MinIntervalMs)*time.Millisecond, s.Clock)
	} else {
		s.client.SetInterval(time.Duration(settings.MinIntervalMs) * time.Millisecond)
		s.client.seenMu.Lock()
		s.client.seen = map[string]int{}
		s.client.seenMu.Unlock()
	}
	run := &Run{
		svc:      s,
		ctx:      ctx,
		client:   s.client,
		requests: 0,
		statuses: map[string]int{},
		stats:    map[string]any{},
	}
	run.client.beforeRequest = run.spendQuota
	run.client.afterResponse = func(status int) {
		key := fmt.Sprint(status)
		if status >= 500 {
			key = "5xx"
		}
		run.count(key)
		run.checkBreaker()
	}
	runRec, err := s.Q.InsertSyncRun(ctx, sqlc.InsertSyncRunParams{Task: task, StartedAt: s.Clock.Now(), ParserVersion: 1})
	if err != nil {
		return nil, err
	}
	run.runID = runRec.ID
	s.Log.Info("crawl started", "task", task, "runId", run.runID)

	run.robot, err = run.loadRobots()
	taskErr := err
	if err == nil {
		taskErr = s.runTaskBody(ctx, run, task)
	}

	outcome, reason := "ok", ""
	switch {
	case run.aborted: // the loop may have ended before checking the flag
		outcome, reason = "aborted", run.abortWhy
	case errors.Is(taskErr, ErrAborted):
		outcome, reason = "aborted", run.abortWhy
	case errors.Is(taskErr, ErrQuotaExceeded):
		outcome, reason = "partial", "quota_exhausted"
	case taskErr != nil:
		outcome, reason = "failed", taskErr.Error()
	}
	run.finish(outcome, reason)
	if err := s.finalizeRun(run, task, settings, taskErr); err != nil {
		return nil, err
	}
	rec, err := s.Q.GetSyncRun(ctx, runRec.ID)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// finalizeRun applies the breaker bookkeeping: aborted runs increment
// consecutive_aborts (3 in a row auto-disable, PRD 22.4.6), anything else
// resets it. Aborts and the auto-disable are logged for the operator.
func (s *Service) finalizeRun(run *Run, task string, settings sqlc.CrawlerSetting, taskErr error) error {
	// An abort is either a returned ErrAborted or the breaker/captcha flag
	// set after the last candidate (the loop may end without checking it).
	aborted := run.aborted || errors.Is(taskErr, ErrAborted)
	aborts := settings.ConsecutiveAborts
	if aborted {
		aborts++
	} else if taskErr == nil || errors.Is(taskErr, ErrQuotaExceeded) {
		aborts = 0 // a clean (or quota-truncated) run resets the streak
	}
	autoDisabled := aborted && aborts >= 3
	reason := settings.AutoDisabledReason
	if autoDisabled {
		reason = fmt.Sprintf("crawler auto-disabled after %d consecutive aborted runs", aborts)
	}
	if _, err := s.Q.UpdateCrawlerSettings(context.Background(), sqlc.UpdateCrawlerSettingsParams{
		ConsecutiveAborts:  pgInt4Ptr(aborts),
		AutoDisabled:       pgBoolPtr(autoDisabled),
		AutoDisabledReason: pgTextPtr(reasonIf(autoDisabled, reason)),
	}); err != nil {
		return err
	}
	if autoDisabled {
		s.Log.Error("crawler auto-disabled", "task", task, "consecutiveAborts", aborts)
	} else if aborted {
		// taskErr may be nil when the loop ended without re-checking the
		// abort flag; the reason lives on the run either way.
		s.Log.Warn("crawl run aborted", "task", task, "reason", run.abortWhy)
	}
	return nil
}

// loadRobots fetches and parses robots.txt; it counts as a request and is
// re-read at the start of every run (PRD 22.4 / 22.2).
func (r *Run) loadRobots() (*robotstxt.Group, error) {
	resp, err := r.client.Get(r.ctx, "/robots.txt")
	if err != nil {
		return nil, fmt.Errorf("robots fetch: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("robots HTTP %d: refusing content fetch", resp.StatusCode)
	}
	if IsCaptchaPage(resp.Body) {
		r.abort("human verification page detected")
		return nil, ErrAborted
	}
	robots, err := robotstxt.FromStatusAndBytes(resp.StatusCode, resp.Body)
	if err != nil {
		return nil, err
	}
	return robots.FindGroup(robotsGroupName(r.svc.Cfg.CrawlerUserAgent)), nil
}

// robotsGroupName extracts the product token from the configured UA.
func robotsGroupName(ua string) string {
	if i := strings.Index(ua, "/"); i > 0 {
		return ua[:i]
	}
	return ua
}

// isAllowed checks robots for the UA group.
func (r *Run) isAllowed(path string) bool {
	return r.robot.Test(path)
}

// spendQuota reserves one request against the daily cap (PRD 22.4.2).
func (r *Run) spendQuota() error {
	if r.aborted {
		return ErrAborted
	}
	settings, err := r.svc.Q.GetCrawlerSettings(r.ctx)
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return ErrPaused
	}
	if settings.AutoDisabled {
		return ErrAutoDisabled
	}
	day := r.svc.Clock.Now().In(r.svc.Cfg.OpsTimezone)
	used, err := r.svc.Q.GetCrawlerQuota(r.ctx, day)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if used >= settings.DailyCap {
		return ErrQuotaExceeded
	}
	if _, err := r.svc.Q.IncrementCrawlerQuota(r.ctx, day); err != nil {
		return err
	}
	r.requests++
	return nil
}

// fetch gets one path under the full discipline: robots, quota, breaker.
// The path must be one of the four allowed shapes (PRD 22.4.1).
func (r *Run) fetch(path string) (*Response, error) {
	if !r.isAllowed(path) {
		return nil, ErrDisallowed
	}
	resp, err := r.client.Get(r.ctx, path)
	r.checkBreaker()
	if err != nil {
		if errors.Is(err, ErrCrossHostRedirect) {
			r.statuses["redirect"]++
			return nil, err
		}
		r.statuses["error"]++
		return nil, err
	}

	// Captcha page (PRD 22.4.6): verify + abort immediately.
	if resp.StatusCode == 200 && IsCaptchaPage(resp.Body) {
		r.statuses["captcha"]++
		r.abort("human verification page detected")
		return nil, ErrAborted
	}
	return resp, nil
}

// checkBreaker aborts the run once the 403/429 wire count crosses the
// threshold; it runs even when the request itself ended in an error.
func (r *Run) checkBreaker() {
	if r.aborted {
		return
	}
	seen := r.client.Seen()
	forbidden := seen["403"] + seen["429"]
	if forbidden >= breakerThreshold {
		r.abort(fmt.Sprintf("breaker: %d 403/429 responses in this run", forbidden))
	}
}

// abort marks the run to stop at the next check.
func (r *Run) abort(reason string) {
	r.aborted = true
	r.abortWhy = reason
}

func (r *Run) finish(outcome, reason string) {
	ctx := context.Background()
	r.stats["parseAttempts"] = r.parseAttempts
	r.stats["parseFailures"] = r.parseFailures
	if r.parseAttempts > 0 && r.parseFailures*5 > r.parseAttempts {
		r.svc.Log.Warn("crawler operator alert", "reason", "parse_failure_rate_above_20_percent",
			"runId", r.runID, "parseAttempts", r.parseAttempts, "parseFailures", r.parseFailures)
	}
	statsJSON := marshalJSON(r.stats)
	statusJSON := marshalJSON(r.statuses)
	err := r.svc.Q.FinishSyncRun(ctx, sqlc.FinishSyncRunParams{
		ID: r.runID, FinishedAt: ptrTime(r.svc.Clock.Now()), Requests: int32(r.requests),
		StatusCounts: statusJSON, Stats: statsJSON, Outcome: outcome, AbortReason: reason,
	})
	if err != nil {
		r.svc.Log.Error("finish sync run", "error", err)
	}
	r.svc.Log.Info("crawl finished", "runId", r.runID, "outcome", outcome, "requests", r.requests, "reason", reason)
}

// marshalJSON marshals the sync_runs jsonb columns, defaulting to {}.
func marshalJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}

// CheckHealth emits an operator alert when enabled crawling has had no
// successful run in 24 hours. Deployments route these structured logs to
// their existing operations alert channel.
func (s *Service) CheckHealth(ctx context.Context) {
	if !s.Cfg.CrawlerEnabled {
		return
	}
	settings, err := s.Q.GetCrawlerSettings(ctx)
	if err != nil || !settings.Enabled {
		return
	}
	var last *time.Time
	if err := s.Pool.QueryRow(ctx, "SELECT max(finished_at) FROM sync_runs WHERE outcome = 'ok'").Scan(&last); err != nil {
		s.Log.Error("crawler health query failed", "error", err)
		return
	}
	if last == nil || s.Clock.Now().Sub(*last) >= 24*time.Hour {
		s.Log.Warn("crawler operator alert", "reason", "no_successful_run_in_24_hours")
	}
}
