package crawler

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gocolly/colly/v2"

	"playtrail/backend/internal/clock"
)

const (
	maxRetryAfter    = 60 * time.Second
	maxRetries       = 3
	breakerThreshold = 5 // 403/429 responses that abort a run (PRD 22.4.6)
	// Colly's default body cap is 10 MB; the real English sitemap is ~15 MB
	// (PRD 22.4.5), so allow 32 MB and treat truncation as an error.
	maxBodySize = 32 << 20
)

var captchaMarkers = []string{"cf-challenge", "just a moment", "captcha", "challenge-platform"}

// Response is a fetched page.
type Response struct {
	StatusCode int
	Header     http.Header
	Body       []byte
	FinalURL   string
}

// Client fetches one host under the PRD 22.4 discipline. The HTTP layer is
// gocolly/colly (one synchronous collector, LimitRule for the spacing); the
// politeness policy around it — robots.txt, quota, Retry-After/backoff,
// conditional requests, the 403/429 breaker — stays in this package so the
// fetch implementation can be swapped without touching the tasks.
type Client struct {
	c *colly.Collector

	ua            string
	clock         clock.Clock
	validators    map[string]validator
	bodies        map[string][]byte
	vmu           sync.Mutex
	seenMu        sync.Mutex
	seen          map[string]int // responses seen on the wire this run, by status
	mu            sync.Mutex
	captured      *Response
	requestErr    error // transport guard errors, guarded by mu
	beforeRequest func() error
	afterResponse func(int)
	redirected    string // cross-host redirect refusal from the last Visit, if any
}

type validator struct {
	etag         string
	lastModified string
}

// NewClient builds a client with the given minimum request interval.
func NewClient(ua string, minInterval time.Duration, clk clock.Clock) *Client {
	c := &Client{
		ua:         ua,
		clock:      clk,
		validators: map[string]validator{},
		bodies:     map[string][]byte{},
		seen:       map[string]int{},
	}
	c.c = c.newCollector(minInterval)
	return c
}

// newCollector builds the colly collector for one fetch discipline. Kept in
// a factory so SetInterval can swap in fresh limit rules.
func (c *Client) newCollector(minInterval time.Duration) *colly.Collector {
	base, err := url.Parse(baseURL())
	if err != nil {
		panic(err) // baseURL is a compile-time constant or validated env value
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		// DialContext runs for https targets too (TLS is layered on top by
		// the transport), so the address guard lives here.
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if guardsEnabled() {
				return dialProduction(ctx, dialer, network, addr)
			}
			return dialer.DialContext(ctx, network, addr)
		},
	}
	col := colly.NewCollector(
		colly.UserAgent(c.ua),
		colly.AllowedDomains(base.Hostname()),
		colly.AllowURLRevisit(),
	)
	// Our own robots.txt handling counts the request against the quota and
	// the SyncRun; colly's built-in check would fetch it outside both.
	col.IgnoreRobotsTxt = true
	col.MaxBodySize = maxBodySize
	// Non-2xx responses must reach our status-code handling, not colly's
	// synthetic "Not Found" errors.
	col.ParseHTTPErrorResponse = true
	col.SetRequestTimeout(30 * time.Second)
	col.WithTransport(&requestTransport{base: transport, client: c, host: base.Host,
		interval: max(minInterval, 2*time.Second)})
	// PRD 22.4.7: follow same-host redirects only; anything else counts as
	// a failure. The refusal is recorded on the client: colly's error
	// wrapping loses the error type, so Get checks this flag instead of
	// unwrapping.
	col.SetRedirectHandler(func(req *http.Request, via []*http.Request) error {
		if req.URL.Host != base.Host || (req.URL.Scheme != "https" && guardsEnabled()) {
			c.setRedirected(fmt.Sprintf("cross-host redirect to %s refused", req.URL))
			return &redirectError{msg: "cross-host redirect refused"}
		}
		if len(via) > 3 {
			c.setRedirected("too many redirects")
			return &redirectError{msg: "too many redirects"}
		}
		return nil
	})
	// PRD 22.4.2: one host, strictly serial, min interval + 0-1s jitter.
	_ = col.Limit(&colly.LimitRule{
		DomainGlob:  base.Host,
		Parallelism: 1,
		Delay:       minInterval,
		RandomDelay: time.Second,
	})
	col.OnRequest(func(r *colly.Request) {
		if v, ok := c.validatorFor(r.URL.String()); ok {
			if v.etag != "" {
				r.Headers.Set("If-None-Match", v.etag)
			}
			if v.lastModified != "" {
				r.Headers.Set("If-Modified-Since", v.lastModified)
			}
		}
	})
	col.OnResponse(func(r *colly.Response) {
		resp := &Response{
			StatusCode: r.StatusCode,
			Header:     *r.Headers,
			Body:       r.Body,
			FinalURL:   r.Request.URL.String(),
		}
		switch resp.StatusCode {
		case http.StatusNotModified:
			c.vmu.Lock()
			resp.Body = c.bodies[resp.FinalURL]
			c.vmu.Unlock()
			if resp.Body != nil {
				resp.StatusCode = http.StatusOK
			}
		case http.StatusOK:
			c.storeValidator(resp.FinalURL, *r.Headers)
			// Cache only the three small-count control documents. Per-game
			// 304s use the normalized source row rather than retaining HTML
			// for the whole catalog in memory.
			if !strings.HasPrefix(r.Request.URL.Path, "/game/") && len(resp.Body) < maxBodySize {
				c.vmu.Lock()
				c.bodies[resp.FinalURL] = resp.Body
				c.vmu.Unlock()
			}
		}
		c.mu.Lock()
		c.captured = resp
		c.mu.Unlock()
	})
	return col
}

// SetInterval updates the minimum request interval (settings change) by
// swapping in a collector with fresh limit rules.
func (c *Client) SetInterval(d time.Duration) {
	c.c = c.newCollector(d)
}

// ErrCrossHostRedirect marks a refused redirect hop.
var ErrCrossHostRedirect = errors.New("cross-host redirect refused")

// Get fetches one path under the base URL. The caller has already checked
// robots and quota. 429/503 responses are retried with Retry-After honoring
// and exponential backoff (PRD 22.4.6); the retry responses still count
// toward the breaker via Seen.
func (c *Client) Get(ctx context.Context, path string) (*Response, error) {
	u := baseURL() + path

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff after 429/503 (PRD 22.4.6).
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(1<<attempt) * time.Second):
			}
		}
		c.mu.Lock()
		c.captured = nil
		c.redirected = ""
		c.requestErr = nil
		c.mu.Unlock()
		// The collector is serial; pointing it at the run's context makes
		// cancellation and the abort flag stop in-flight work.
		c.c.Context = ctx

		err := c.c.Visit(u)
		if requestErr := c.takeRequestErr(); requestErr != nil {
			return nil, requestErr
		}
		seen := c.Seen()
		if seen["403"]+seen["429"] >= breakerThreshold {
			return nil, ErrAborted
		}
		if err != nil {
			// Colly checks AllowedDomains before our redirect handler. Its
			// refusal is still a cross-host redirect, never a retryable error.
			if errors.Is(err, colly.ErrForbiddenDomain) {
				return nil, fmt.Errorf("%w: %v", ErrCrossHostRedirect, err)
			}
			if msg := c.takeRedirected(); msg != "" {
				return nil, fmt.Errorf("%w: %s", ErrCrossHostRedirect, msg)
			}
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			lastErr = err
			continue // network errors: retry within the run
		}
		c.mu.Lock()
		resp := c.captured
		c.mu.Unlock()
		if resp == nil {
			lastErr = errors.New("no response captured")
			continue
		}
		if resp.StatusCode == http.StatusNotModified {
			return resp, nil
		}
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusServiceUnavailable {
			if attempt == maxRetries {
				return resp, nil
			}
			wait := retryAfter(resp.Header.Get("Retry-After"))
			// Never retry sooner than the server asked. A longer wait ends
			// this run rather than capping the wait and retrying too early.
			if wait > maxRetryAfter {
				return resp, nil
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(wait):
			}
			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)
			continue
		}
		if len(resp.Body) >= maxBodySize {
			return nil, fmt.Errorf("response body exceeded %d bytes", maxBodySize)
		}
		return resp, nil
	}
	return nil, lastErr
}

// recordSeen counts every response received on the wire, including the ones
// consumed by 429/503 retries — the breaker (PRD 22.4.6) must see those.
func (c *Client) recordSeen(status int) {
	c.seenMu.Lock()
	c.seen[strconv.Itoa(status)]++
	c.seenMu.Unlock()
}

// Seen returns a copy of the per-status response counts for this run.
func (c *Client) Seen() map[string]int {
	c.seenMu.Lock()
	defer c.seenMu.Unlock()
	out := make(map[string]int, len(c.seen))
	for k, v := range c.seen {
		out[k] = v
	}
	return out
}

// requestTransport covers every wire request, including redirects and retries.
// Colly applies its LimitRule around visits; this guard also spaces redirect
// hops and reserves quota before any network I/O.
type requestTransport struct {
	base      *http.Transport
	client    *Client
	host      string
	interval  time.Duration
	lastStart time.Time
}

func (t *requestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	c := t.client
	if req.URL.Host != t.host || !allowedPath(req.URL.Path) || req.URL.RawQuery != "" {
		c.requestErr = fmt.Errorf("crawler URL not allowed: %s", req.URL)
		return nil, c.requestErr
	}
	if wait := time.Until(t.lastStart.Add(t.interval)); wait > 0 {
		select {
		case <-req.Context().Done():
			return nil, req.Context().Err()
		case <-time.After(wait):
		}
	}
	if err := req.Context().Err(); err != nil {
		return nil, err
	}
	if c.beforeRequest != nil {
		if err := c.beforeRequest(); err != nil {
			c.setRequestErr(err)
			return nil, err
		}
	}
	t.lastStart = time.Now()
	resp, err := t.base.RoundTrip(req)
	if resp != nil {
		c.recordSeen(resp.StatusCode)
		if c.afterResponse != nil {
			c.afterResponse(resp.StatusCode)
		}
	}
	return resp, err
}

func allowedPath(path string) bool {
	switch path {
	case "/robots.txt", "/sitemap-index.xml", "/en/sitemap", "/hot":
		return true
	}
	return gameURLPattern.MatchString(path) && strings.HasPrefix(path, "/game/")
}

func retryAfter(value string) time.Duration {
	if seconds, err := strconv.ParseInt(value, 10, 32); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if date, err := http.ParseTime(value); err == nil {
		return max(0, time.Until(date))
	}
	return 0
}

// Resolve once, validate all answers, then dial the validated IP. Resolving
// again in DialContext would open a DNS-rebinding gap.
func dialProduction(ctx context.Context, dialer *net.Dialer, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	if host != "www.crazygames.com" || port != "443" {
		return nil, fmt.Errorf("crawler address blocked: %s", addr)
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if !ip.IP.IsGlobalUnicast() || ip.IP.IsLoopback() || ip.IP.IsPrivate() || ip.IP.IsLinkLocalUnicast() {
			return nil, fmt.Errorf("private address blocked: %s", addr)
		}
	}
	var lastErr error
	for _, ip := range ips {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no addresses resolved for %s", host)
	}
	return nil, lastErr
}

func (c *Client) validatorFor(u string) (validator, bool) {
	c.vmu.Lock()
	defer c.vmu.Unlock()
	v, ok := c.validators[u]
	return v, ok
}

func (c *Client) storeValidator(u string, h http.Header) {
	c.vmu.Lock()
	defer c.vmu.Unlock()
	c.validators[u] = validator{etag: h.Get("ETag"), lastModified: h.Get("Last-Modified")}
}

// IsCaptchaPage reports whether a 200 response is actually a human-verification
// page rather than the expected content (PRD 22.4.6).
func IsCaptchaPage(body []byte) bool {
	if hasNEXTData(body) {
		return false
	}
	lower := strings.ToLower(string(body[:min(4096, len(body))]))
	for _, marker := range captchaMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// setRequestErr/takeRequestErr guard the transport error shared between the
// RoundTrip goroutine and the visiting goroutine.
func (c *Client) setRequestErr(err error) {
	c.mu.Lock()
	c.requestErr = err
	c.mu.Unlock()
}

func (c *Client) takeRequestErr() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	err := c.requestErr
	c.requestErr = nil
	return err
}

func (c *Client) setRedirected(msg string) {
	c.mu.Lock()
	c.redirected = msg
	c.mu.Unlock()
}

func (c *Client) takeRedirected() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	msg := c.redirected
	c.redirected = ""
	return msg
}

type redirectError struct{ msg string }

func (e *redirectError) Error() string { return e.msg }
