//go:build !e2e

package crawler

// baseURL is the fixed production target (PRD 22.4.1). Not configurable in
// normal builds; production address guards are always on.
func baseURL() string { return defaultBaseURL }

// guardsEnabled is always true in production builds.
func guardsEnabled() bool { return true }

// validateBaseURL is a no-op in normal builds: the base URL is the fixed
// production constant (PRD 22.4.1) and cannot be overridden.
func validateBaseURL() error { return nil }
