# Behavior fixes: failure scenarios and acceptance

Before implementation, the following failures must be covered. Prefer the existing E2E harness; use real PostgreSQL for session/cache integration checks, never a fake that ignores connection ownership.

1. Category navigation: selecting a tag or sort on `/en/categories/sim` must keep that category path; searching must keep existing tag/sort, reset pagination, and submit an empty query as removal. Clearing filters must keep the category; removing the category chip may deliberately return to all games. Back navigation must restore state. The all-games page must retain category/tag/sort on search too.
2. Job locks: another PostgreSQL session cannot acquire the same job lock during execution. After success, panic, or cancellation, cleanup must release on the original session. Unlock failure must never return a locked session to the pool; a contended lock must skip execution and a DB error must be distinguishable from contention.
3. Dictionary cache: alternating Categories/Tags must not invalidate the other entry. Each cache must expire independently, including empty dictionaries; failed loads must not extend expiry or discard the other cache.
4. CLI config: optional mode must load a supplied INTERNAL_SECRET, accept an absent secret, and reject a supplied short secret. Required mode must reject an absent/short secret. Seed/rebuild must use the loaded value for cache notification, while absent credentials retain warning/skip behavior.
5. Admin identity: unauthenticated/stale sessions remain 401. A successful admin request must use the identity already verified by middleware, without a second DB lookup. Never trust a client-supplied identity.
6. API contract: cards allow at most three tags, details allow up to eight and reject nine. An available CTA's null outboundBlockedReason and a blocked CTA's link_unavailable must validate; unknown reasons must fail. Regenerated API types must match the schema.

Record actual commands, outcomes and artifact paths after verification. Passing the existing suite alone does not establish coverage of every scenario above.

## Repeatable verification

From the repository root, run the full browser suite (requires the local development PostgreSQL container; resets only the isolated E2E database):

```bash
make e2e
```

Then run the real PostgreSQL integration checks against that populated isolated database. Set `INTEGRATION_DSN` to its DSN; do not use the production database (the rebuild check refreshes its public read model).

```bash
cd backend && go test -race -tags integration ./cmd/playtrail ./internal/catalog -run Integration -v -count=1
```

Validate the OpenAPI against a captured public detail JSON response (PyYAML and jsonschema required):

```bash
python3 -I e2e/scripts/validate-public-schema.py --schema api/openapi.yaml --detail e2e/report/public-detail.json --output e2e/report/behavior-schema.json
```

Artifacts: `e2e/report/results.json`, `e2e/report/html/index.html`, `e2e/report/behavior-integration.log`, `e2e/report/behavior-schema.json`. Reports are local generated evidence, not source files to commit.

## Verified results

- Go build and vet: normal and E2E build tags passed; sqlc compile passed.
- Web TypeScript and lint passed; OpenAPI generation, YAML parse and Redocly validation passed (9 existing warnings).
- Full Playwright suite: 72 passed, no failures/skips/flaky; E28 adds two actual-control regressions on each of four browser/viewport projects.
- Real PostgreSQL integration with the race detector passed: lock mutual exclusion, normal/cancel/panic cleanup, contention, terminated lock session and pool recovery, closed-pool error, independent dictionary caches, config cases, and actual rebuild notification delivery/skip.
- Actual OpenAPI schemas validated against a captured public detail: 8/8 expected acceptance/rejection cases passed.
- Notifier receiver checks route/header/body; this does not establish that the real Next.js cache was invalidated. Seed notification delivery was not separately exercised.

Scope notes: the fixed category is not a removable filter chip; use category navigation or All games to leave it. The header search remains a global search. Cache expiry checks advance each private expiry directly rather than sleeping, and empty-cache checks inject an empty loaded state. Identity query reuse is verified by source/reference inspection plus existing authenticated API E2E, not a query-count instrument. A stale-session-specific regression is not included.

