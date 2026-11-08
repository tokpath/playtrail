//go:build e2e

package crawler

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
)

// baseURL returns the fake-server target. In e2e builds CRAWLER_BASE_URL is
// required and must be a loopback http:// URL - there is no fallback to the
// real host (C5): an e2e binary must never be able to reach production.
func baseURL() string {
	u, err := url.Parse(os.Getenv("CRAWLER_BASE_URL"))
	if err != nil || u.Scheme == "" || u.Host == "" {
		panic("crawler e2e: CRAWLER_BASE_URL is invalid") // RunTask validated first
	}
	return u.String()
}

// guardsEnabled is always false in e2e builds: the target is the local fake
// server (plain http on a non-standard port) by construction.
func guardsEnabled() bool { return false }

// validateBaseURL refuses to start the crawler unless CRAWLER_BASE_URL points
// at a loopback http:// fake server (C5).
func validateBaseURL() error {
	raw := os.Getenv("CRAWLER_BASE_URL")
	u, err := url.Parse(raw)
	if err != nil || raw == "" || u.Scheme != "http" || u.Host == "" {
		return errors.New("crawler e2e: CRAWLER_BASE_URL is required and must be a loopback http:// URL (e.g. http://127.0.0.1:8090)")
	}
	host := u.Hostname()
	if ip := net.ParseIP(host); !(host == "localhost" || (ip != nil && ip.IsLoopback())) {
		return fmt.Errorf("crawler e2e: CRAWLER_BASE_URL must point at loopback, got %q", raw)
	}
	return nil
}
