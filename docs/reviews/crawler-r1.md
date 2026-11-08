# Crawler review, round 1 (Opus)

Scope: `backend/internal/crawler/client.go`, plus the base-URL handling in `baseurl*.go`. The fake-server results (11 groups) come from the implementer's report; this review reads the code.

Accepted: fixed production host (constant, overridable only under the `e2e` tag); DNS resolved once and all answers validated before dialing; every wire request (including redirect hops and retries) passes the path whitelist and the quota hook in `requestTransport.RoundTrip`; Colly's robots check off with a reason, our own check counted; body cap 32 MB with an explicit truncation check; non-2xx responses routed through `ParseHTTPErrorResponse`.

## Should fix (bundle with the final-review round)

- **C1** `client.go:224`: detects Colly's domain refusal by matching the error string `"Forbidden domain"`. Use `errors.Is(err, colly.ErrForbiddenDomain)`.
- **C2** `client.go:185`: `ErrCrossHostRedirect = fmt.Errorf(...)` with no verbs; use `errors.New`.
- **C3** `client.go:214`: `c.requestErr` is read without `c.mu`, while `RoundTrip` writes it (lines 305, 320). Guard it like `captured`/`redirected`, or return it via a helper.
- **C4** `e2e/fake-crazygames/verify.py`: a Python runner sits outside the agreed E2E stack (Playwright + Go fake server). Either fold these checks into the Playwright suite (E24–E27) or document in the E2E README that it is the crawler's evidence runner, with the command and its prerequisites.

## Noted, no change now
- Alerts go to structured logs only; no mail/webhook channel exists until the owner provides one (listed as an open item at delivery).
- Conditional-request cache is in-process, so the first request after a restart is unconditional. Acceptable.
- One extra real request (`/game/bloxdhop-io`) happened during debugging; disclosed by the implementer. No debug path to the real host remains: the base URL is fixed in normal builds.
