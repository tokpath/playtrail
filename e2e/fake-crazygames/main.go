// Command fake-crazygames is the e2e stand-in for www.crazygames.com
// (PRD 22 e2e scenarios). It serves the real page samples captured in
// ./samples and exposes control + logging endpoints so tests can simulate
// failure modes without touching the real site:
//
//	GET  /robots.txt | /en/sitemap | /sitemap-index.xml | /hot | /game/{slug}
//	GET  /_control                     current scenario state
//	POST /_control                     set scenarios (global and per-slug)
//	GET  /_log                         request log (time, method, path, UA)
//	DELETE /_log                       clear the request log
//
// POST /_control body:
//
//	{"global": {"type": "rate_limit", "retryAfterSec": 2, "times": 2},
//	 "games": {"bloxity-io": {"type": "renamed", "newName": "Bloxity Rewritten"}},
//	 "reset": true}
//
// Global scenarios apply to every content path; per-slug scenarios override
// them for one game page. Scenario types: not_found, rate_limit, server_error,
// captcha, unpublished, renamed, redirect, robots_disallow. "times" limits how
// many responses the scenario applies to before the server reverts to normal
// (0 = unlimited). "unpublished" and "renamed" rewrite fields inside the
// sample's __NEXT_DATA__ JSON; "redirect" points at "redirectHost" (default
// example.com) to exercise the same-host redirect rule; "robots_disallow"
// appends "Disallow: <newStatus or /en/sitemap>" to the robots sample.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

type scenario struct {
	Type          string `json:"type"`
	RetryAfterSec int    `json:"retryAfterSec"`
	Times         int    `json:"times"`
	NewName       string `json:"newName"`
	NewStatus     string `json:"newStatus"`
	RedirectHost  string `json:"redirectHost"`
	PadBytes      int64  `json:"padBytes"` // huge_body: pad the response to this size
}

type state struct {
	mu     sync.Mutex
	global *scenario
	games  map[string]*scenario
	log    []map[string]any
}

var nextDataRe = regexp.MustCompile(`(<script id="__NEXT_DATA__"[^>]*>)(.*?)(</script>)`)

func main() {
	addr := flag.String("addr", "127.0.0.1:8090", "listen address")
	samples := flag.String("samples", "./samples", "sample directory")
	flag.Parse()

	st := &state{games: map[string]*scenario{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /robots.txt", func(w http.ResponseWriter, r *http.Request) {
		st.serve(w, r, "", *samples+"/robots.txt", "text/plain; charset=utf-8")
	})
	mux.HandleFunc("GET /en/sitemap", func(w http.ResponseWriter, r *http.Request) {
		st.serve(w, r, "", *samples+"/sitemap.xml", "application/xml; charset=utf-8")
	})
	mux.HandleFunc("GET /sitemap-index.xml", func(w http.ResponseWriter, r *http.Request) {
		st.serve(w, r, "", *samples+"/sitemap-index.xml", "application/xml; charset=utf-8")
	})
	mux.HandleFunc("GET /hot", func(w http.ResponseWriter, r *http.Request) {
		st.serve(w, r, "", *samples+"/hot.html", "text/html; charset=utf-8")
	})
	mux.HandleFunc("GET /game/", func(w http.ResponseWriter, r *http.Request) {
		slug := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/game/"), "/")
		st.serve(w, r, slug, *samples+"/games/"+slug+".html", "text/html; charset=utf-8")
	})
	mux.HandleFunc("GET /_control", func(w http.ResponseWriter, r *http.Request) { getControl(w, r, st) })
	mux.HandleFunc("POST /_control", func(w http.ResponseWriter, r *http.Request) { postControl(w, r, st) })
	mux.HandleFunc("GET /_log", func(w http.ResponseWriter, r *http.Request) { getLog(w, r, st) })
	mux.HandleFunc("DELETE /_log", func(w http.ResponseWriter, r *http.Request) { clearLog(w, r, st) })

	log.Printf("fake-crazygames listening on http://%s (samples: %s)", *addr, *samples)
	log.Fatal(http.ListenAndServe(*addr, st.tracked(mux)))
}

// tracked wraps the mux so every request is logged for the spacing/UA checks.
func (st *state) tracked(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/_log") && !strings.HasPrefix(r.URL.Path, "/_control") {
			st.mu.Lock()
			st.log = append(st.log, map[string]any{
				"time":   time.Now().UTC().Format(time.RFC3339Nano),
				"method": r.Method, "path": r.URL.Path, "ua": r.UserAgent(),
				"ifNoneMatch": r.Header.Get("If-None-Match"), "ifModifiedSince": r.Header.Get("If-Modified-Since"),
			})
			st.mu.Unlock()
		}
		next.ServeHTTP(w, r)
	})
}

// pickFor returns the scenario for a request (per-slug first, then global),
// or nil when the scenario does not apply to this file (e.g. captcha only
// makes sense on content pages, robots_disallow only on robots.txt). A
// limited scenario is consumed only when it applies.
func (st *state) pickFor(slug, file string) *scenario {
	st.mu.Lock()
	defer st.mu.Unlock()
	sc := st.games[slug]
	if sc == nil {
		sc = st.global
	}
	if sc == nil {
		return nil
	}
	robots := strings.HasSuffix(file, "robots.txt")
	switch sc.Type {
	case "robots_disallow":
		if !robots {
			return nil
		}
	case "rate_limit", "server_error":
		// applies everywhere
	default:
		if robots {
			return nil
		}
	}
	if sc.Times > 0 {
		sc.Times--
		if sc.Times == 0 {
			delete(st.games, slug)
			if st.global == sc {
				st.global = nil
			}
		}
	}
	copy := *sc
	return &copy
}

// serve reads the sample file and applies the picked scenario to it. Scenarios
// that only make sense on game pages (unpublished, renamed) mutate the
// __NEXT_DATA__ payload; others rewrite the response wholesale.
func (st *state) serve(w http.ResponseWriter, r *http.Request, slug, file, ctype string) {
	// Scenarios that replace the whole response come first, so they work
	// even when no sample file exists for the slug.
	sc := st.pickFor(slug, file)
	if sc != nil {
		switch sc.Type {
		case "forbidden":
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		case "malformed":
			serve(w, []byte("<!doctype html><p>Unexpected page without game data</p>"), "text/html")
			return
		case "not_found":
			http.Error(w, "not found", http.StatusNotFound)
			return
		case "rate_limit":
			retry := sc.RetryAfterSec
			if retry <= 0 {
				retry = 2
			}
			w.Header().Set("Retry-After", fmt.Sprint(retry))
			http.Error(w, "rate limited", http.StatusTooManyRequests)
			return
		case "server_error":
			http.Error(w, "upstream error", http.StatusServiceUnavailable)
			return
		case "captcha":
			serve(w, []byte("<!doctype html><html><head><title>Just a moment...</title></head>"+
				"<body>cf-challenge: enable javascript and cookies to continue; challenge-platform verification.</body></html>"),
				"text/html; charset=utf-8")
			return
		case "redirect":
			host := sc.RedirectHost
			if host == "" {
				host = "example.com"
			}
			http.Redirect(w, r, "https://"+host+r.URL.Path, http.StatusFound)
			return
		}
	}
	body, err := os.ReadFile(file)
	if err != nil {
		http.Error(w, fmt.Sprintf("no sample for %q", file), http.StatusNotFound)
		return
	}
	if sc != nil && sc.Type == "huge_body" {
		// Pad inside an XML comment so the document stays well-formed; used
		// to push the response past the client's 32 MB body cap.
		pad := sc.PadBytes
		if pad <= 0 {
			pad = 33 << 20
		}
		pad -= int64(len(body))
		if pad > 0 {
			body = append(body, []byte("<!--")...)
			body = append(body, bytes.Repeat([]byte(" "), int(pad))...)
			body = append(body, []byte("-->")...)
		}
	}
	if sc != nil && sc.Type == "robots_disallow" {
		// Append a dedicated group: tacking a Disallow onto the file end
		// would land in the last existing group (correctly ignored by
		// robots.txt semantics).
		path := sc.NewStatus
		if path == "" {
			path = "/en/sitemap"
		}
		body = append(body, []byte("\nUser-agent: PlayTrailBot\nDisallow: "+path+"\n")...)
	}
	if sc != nil && (sc.Type == "unpublished" || sc.Type == "renamed") {
		mutated, err := mutateGame(body, sc, slug)
		if err != nil {
			http.Error(w, "mutation failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		body = mutated
	}
	if sc != nil && sc.Type == "canonical_mismatch" {
		body = bytes.ReplaceAll(body, []byte("https://www.crazygames.com/game/"+slug), []byte("https://www.crazygames.com/game/different-slug"))
	}
	if sc != nil && sc.Type == "conditional" {
		w.Header().Set("ETag", `"fixture-v1"`)
		w.Header().Set("Last-Modified", "Sun, 08 Nov 2026 00:00:00 GMT")
		if r.Header.Get("If-None-Match") == `"fixture-v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	serve(w, body, ctype)
}

// mutateGame rewrites fields inside the sample's __NEXT_DATA__ payload.
func mutateGame(body []byte, sc *scenario, slug string) ([]byte, error) {
	m := nextDataRe.FindSubmatch(body)
	if m == nil {
		return nil, fmt.Errorf("sample has no __NEXT_DATA__")
	}
	var doc map[string]any
	if err := json.Unmarshal(m[2], &doc); err != nil {
		return nil, err
	}
	props, _ := doc["props"].(map[string]any)
	pageProps, _ := props["pageProps"].(map[string]any)
	g, _ := pageProps["game"].(map[string]any)
	if g == nil {
		return nil, fmt.Errorf("sample has no pageProps.game")
	}
	if sc.Type == "unpublished" {
		status := sc.NewStatus
		if status == "" {
			status = "UNPUBLISHED"
		}
		g["status"] = status
	} else {
		name := sc.NewName
		if name == "" {
			name = "Renamed " + slug
		}
		g["name"] = name
	}
	newPayload, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	return bytes.Replace(body, m[2], newPayload, 1), nil
}

func serve(w http.ResponseWriter, body []byte, ctype string) {
	w.Header().Set("Content-Type", ctype)
	_, _ = w.Write(body)
}

func getControl(w http.ResponseWriter, _ *http.Request, st *state) {
	st.mu.Lock()
	defer st.mu.Unlock()
	items := map[string]any{"global": st.global, "games": st.games}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(items)
}

func postControl(w http.ResponseWriter, r *http.Request, st *state) {
	var in struct {
		Global *scenario            `json:"global"`
		Games  map[string]*scenario `json:"games"`
		Reset  bool                 `json:"reset"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "bad JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if in.Reset {
		st.global = nil
		st.games = map[string]*scenario{}
	}
	if in.Global != nil {
		st.global = in.Global
	}
	for slug, sc := range in.Games {
		st.games[slug] = sc
	}
	w.WriteHeader(http.StatusNoContent)
}

func getLog(w http.ResponseWriter, _ *http.Request, st *state) {
	st.mu.Lock()
	items := append([]map[string]any{}, st.log...)
	st.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
}

func clearLog(w http.ResponseWriter, _ *http.Request, st *state) {
	st.mu.Lock()
	st.log = nil
	st.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}
