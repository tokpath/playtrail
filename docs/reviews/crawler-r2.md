# Crawler review, round 2 (Opus)

## Must fix

### C5 (high): e2e builds fall back to the real host
`internal/crawler/baseurl_e2e.go` returns the production base URL when `CRAWLER_BASE_URL` is empty. Twice during verification an e2e binary started without that variable and sent unplanned requests to www.crazygames.com (`/game/bloxdhop-io` once; `robots.txt` + `/hot` once). Both were disclosed by the implementer.

Fix: in `e2e` builds, `CRAWLER_BASE_URL` is required and must be a loopback `http://` URL. If it is missing or invalid, the crawler refuses to start, with a clear error. There is no fallback to the real host. Normal builds stay as they are (constant host, no override). Then show that an e2e binary without the variable exits with that error, and that no request leaves the machine (check the fake server's log and run with no network route to the real host if practical).

## Accepted
- Games link to their source rows by external URL from every creation path; hot mapping resolves through `source_games.game_id` or the external URL, never our own slug.
- The seed pack supports `developer`.
- The dev catalog was wiped in one transaction, with the source catalog kept, and reseeded with `content/launch-pack.json` (20/20 published). The hot snapshot was rebuilt from already-fetched data with no new real request.

Note: the "placeholder" developer value the implementer saw on build-and-crush is a display redaction by the tool output, not the stored data. The pack and DB hold the real name.
