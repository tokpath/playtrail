//go:build !e2e

package main

import "playtrail/backend/internal/clock"

// buildClock returns the production clock. Only e2e builds can control time.
func buildClock() clock.Clock { return clock.New() }
