//go:build e2e

package clock

import (
	"sync"
	"time"
)

// Settable is a clock that E2E tests can move. Only built with the e2e tag.
type Settable struct {
	mu sync.RWMutex
	t  time.Time
}

// NewSettable returns a settable clock starting at wall time.
func NewSettable() *Settable { return &Settable{t: time.Now()} }

func (c *Settable) Now() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.t
}

// Set moves the clock.
func (c *Settable) Set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = t
}

// Reset returns the clock to wall time.
func (c *Settable) Reset() { c.Set(time.Now()) }
