// Package revalidate calls the Next.js internal revalidate endpoint after
// committing public-affecting changes (ARCHITECTURE §7). Failures are logged
// and never surface to the caller: the 30s revalidate TTL still bounds
// inconsistency at 60 seconds.
package revalidate

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

type Notifier struct {
	url    string
	secret string
	client *http.Client
}

func New(webInternalURL, internalSecret string) *Notifier {
	return &Notifier{
		url:    webInternalURL + "/_internal/revalidate",
		secret: internalSecret,
		client: &http.Client{Timeout: 2 * time.Second},
	}
}

// Notify asynchronously invalidates the given cache tags on the web frontend.
func (n *Notifier) Notify(tags ...string) {
	if n == nil || len(tags) == 0 {
		return
	}
	go n.send(tags)
}

// NotifySync invalidates synchronously: short-lived CLI commands (seed,
// rebuild-public) must not exit before the call leaves the process.
func (n *Notifier) NotifySync(tags ...string) {
	if n == nil || len(tags) == 0 {
		return
	}
	n.send(tags)
}

func (n *Notifier) send(tags []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]any{"tags": tags})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Secret", n.secret)
	resp, err := n.client.Do(req)
	if err != nil {
		slog.Warn("revalidate call failed", "tags", tags, "error", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		slog.Warn("revalidate call rejected", "tags", tags, "status", resp.StatusCode)
	}
}
