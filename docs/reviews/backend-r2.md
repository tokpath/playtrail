# Backend review, round 2 (Opus)

Accepted: C5 (e2e builds require a loopback `http://` CRAWLER_BASE_URL and refuse to start otherwise; no fallback to the real host), reference fields stored as plain text, the admin "upvotes / downvotes" display bug (it was in web, not the backend), and seed/rebuild-public invalidating the web cache synchronously.

Consequence of C5: E2E runs on native loopback processes rather than a docker-compose network. ARCHITECTURE §9 is updated.

## Should fix (bundle with E2E findings)
- **B11** (found by the deploy run): `seed` and `rebuild-public` load config with `requireInternal=false` (`config.go:82-88`, `seed.go:70`), so `INTERNAL_SECRET` is empty and the web rejects the revalidate call with 403. When the CLI is going to notify, load the secret; if it is missing, log one clear warning instead of sending an empty header.
- **B12** (deploy README): `TRUSTED_PROXY_HEADER=CF-Connecting-IP` is safe only if the origin accepts traffic from Cloudflare alone. Document a firewall rule (allow 80/443 from Cloudflare IP ranges only) in deploy/README.md.
- **B10** `cmd/playtrail/seed.go:98`: the cache is not invalidated when some rows fail. Rows that did publish are then invisible for up to one ISR window. Invalidate whenever at least one row was written, and keep the non-zero exit code for the failed rows.
