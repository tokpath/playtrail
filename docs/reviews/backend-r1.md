# Backend review, round 1 (Opus)

Scope: `backend/internal/catalog/{gates,write}.go`, `backend/internal/api/server.go`, plus the login and event rate-limit paths. Smoke results came from the implementer; this review reads the code itself.

## Must fix

### B1 (high, security): spoofable client IP defeats the login throttle and the event rate limit
`internal/api/server.go:138` `clientIP` trusts any client-sent `X-Forwarded-For` and keys on the whole header value. `admin_session.go:25` builds the login-throttle key from email + that IP, so an attacker who sends a new XFF on every request gets unlimited password guesses against the admin account. `public.go:151` lets the same trick bypass the events limiter.

Fix:
- Add config `TRUSTED_PROXY_HEADER` (default empty). When empty, use only `RemoteAddr`. In production set it to `CF-Connecting-IP` (Cloudflare sets it; Caddy passes it through). Honor the header only when `RemoteAddr` is loopback or private (requests coming from Caddy on the compose network). Otherwise ignore it.
- Parse the header with `net.ParseIP`. If the value is not a single valid IP, fall back to `RemoteAddr`.
- Also throttle per account regardless of IP: for example, more than 30 failures per email in 15 minutes returns 429. That way IP rotation can never give unlimited guesses on one account. Keep the existing email+IP key as well.
- Update `.env.example` and ARCHITECTURE §2 (the env table) to match.

### B0 (critical): `GET/PATCH /api/admin/games/{id}` hangs, returns 500, and deadlocks the API process
Reported by the frontend implementer while seeding data. The API stopped responding and had to be restarted. This looks like pgxpool exhaustion or a lock wait, for example a query on `s.Q`/`s.Pool` issued while the same request holds a transaction (or `FOR UPDATE`) on another pool connection, or `AdminGame` being called while a transaction is still open. Find the root cause and fix it. Then show that 50 sequential and 10 concurrent `GET /api/admin/games/{id}` calls plus a PATCH all succeed with the pool at its default size, and that the process stays responsive afterwards.

### B7: `api/openapi.yaml:672` is invalid YAML
The unquoted `description: OK, Cache-Control: no-store` breaks openapi-typescript. Quote the value. Validate the whole file with a real parser (e.g. `pnpm dlx @redocly/cli lint api/openapi.yaml`, or openapi-typescript itself), then run `cd web && pnpm gen:api && pnpm typecheck`.

### B8: `/api/home` needs `updatedAt`
Add `updatedAt: string | null` to the home response: the latest `published_at` among live games in that locale. Update ARCHITECTURE §6.2 and openapi.yaml.

## Should fix (quality)

### B2: gates turn DB errors into business failures
`internal/catalog/gates.go:39-44, 57-61, 128-132`: every error from `GetCategory`/`GetTag`/`GetRevisionLocale` is reported as "unknown category / unknown tag / no content". Treat only `pgx.ErrNoRows` as the business failure and return any other error. `computeGates` already declares an `error` return that is never non-nil; make it real.

### B3: `loadAssets` swallows errors
`gates.go:181-195`: a failed `ListMediaAssets` returns an empty map, so callers report "missing asset" or silently drop covers during `rebuildPublicGameTx` (`write.go:886`). Return the error. Drop the unused first return value if no caller needs it.

### B4: duplicated candidate-revision logic
`write.go:768-779` re-implements `candidateRevision` (`gates.go:223`). Split it so a helper takes an already-loaded (locked) game and returns its candidate revision, and use it from both places.

### B5: unused parameters
`localeGate` takes a `now time.Time` parameter it never uses (`gates.go:122`). Remove it.

### B6: ignored category lookup in rebuild
`write.go:866-869` ignores `GetCategory` errors. Handle them like B2.

## Accepted deviations (no change)
Report items 1–6 (URL whitelist English-only for P0, `IMPORT_KEY_REUSED` carrier, cover clearing via `usePlaceholder`, `needs_review` definition, manual hot snapshot slug mapping, golangci-lint v2.15 / go 1.25.0) are accepted. Item 3: add the ability to clear `coverAssetId` to null via an explicit `null` in PATCH.

## Verification after fixing
`go build ./... && go vet ./... && gofmt -l . && golangci-lint run` (also with `-tags e2e`). Using curl, show that login attempt 11 for one email returns 429 even when every request carries a different `X-Forwarded-For`. Rerun the publish smoke flow.
