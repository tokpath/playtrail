// Package clock provides the injected time source used by all business code
// (TECH-STACK §3). E2E builds (build tag "e2e") additionally provide a
// settable clock controllable through POST /api/_test/clock.
package clock

import "time"

// Clock is the time source for business logic.
type Clock interface {
	Now() time.Time
}

type systemClock struct{}

// New returns the production clock.
func New() Clock { return systemClock{} }

func (systemClock) Now() time.Time { return time.Now() }
