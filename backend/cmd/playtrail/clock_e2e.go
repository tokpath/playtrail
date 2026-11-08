//go:build e2e

package main

import "playtrail/backend/internal/clock"

// buildClock returns a settable clock when built with the e2e tag; the test
// endpoints POST/DELETE /api/_test/clock drive it.
func buildClock() *clock.Settable { return clock.NewSettable() }
