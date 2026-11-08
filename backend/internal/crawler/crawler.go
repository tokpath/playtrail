// Package crawler implements the CrazyGames data sync (PRD §22): the four
// scheduled tasks, the request discipline (serial, rate-limited, quota,
// robots, breaker), the source catalog, tracked-game maintenance, and hot
// snapshots. It plugs into the admin API and the worker at the extension
// points left in api/server.go and cmd/playtrail/worker.go.
package crawler

// defaultBaseURL is fixed per PRD 22.4.1; only e2e builds may override it.
const defaultBaseURL = "https://www.crazygames.com"
