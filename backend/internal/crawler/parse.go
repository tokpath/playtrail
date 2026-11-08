package crawler

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// CGGame is the whitelisted view of props.pageProps.game (PRD 22.6): only the
// fields below are ever decoded; everything else is discarded at parse time.
type CGGame struct {
	CanonicalURL    string `json:"-"`
	MetaDescription string `json:"metaDescription"`
	ID              string `json:"id"`
	Name            string `json:"name"`
	Slug            string `json:"slug"`
	Category        struct {
		Slug   string `json:"slug"`
		EnSlug string `json:"enSlug"`
		Name   string `json:"name"`
	} `json:"category"`
	Tags []struct {
		Slug   string `json:"slug"`
		EnSlug string `json:"enSlug"`
		Name   string `json:"name"`
	} `json:"tags"`
	Developer          string `json:"developer"`
	Cover              string `json:"cover"`
	IosFriendly        bool   `json:"iosFriendly"`
	AndroidFriendly    bool   `json:"androidFriendly"`
	MultiplayerOptions struct {
		IsMultiplayer bool `json:"isMultiplayer"`
	} `json:"multiplayerOptions"`
	Status                   string          `json:"status"`
	AddedOn                  string          `json:"addedOn"`
	LastSignificantUpdatedOn string          `json:"lastSignificantUpdatedOn"`
	LastFileUpdatedOn        string          `json:"lastFileUpdatedOn"`
	Rating                   *float64        `json:"rating"`
	Upvotes                  *int64          `json:"upvotes"`
	Downvotes                *int64          `json:"downvotes"`
	DescriptionFirst         string          `json:"descriptionFirst"`
	DescriptionRest          string          `json:"descriptionRest"`
	Controls                 string          `json:"controls"`
	Faq                      json.RawMessage `json:"faq"`
}

// CanonicalURL is the English game page URL for a slug.
func CanonicalURL(slug string) string { return defaultBaseURL + "/game/" + slug }

var nextDataPattern = regexp.MustCompile(`<script id="__NEXT_DATA__"[^>]*>(.*?)</script>`)

// extractNEXTData pulls the __NEXT_DATA__ JSON payload out of a page. The
// regex is deliberately tolerant of extra attributes (the real pages carry
// crossorigin="anonymous").
func extractNEXTData(body []byte) ([]byte, error) {
	m := nextDataPattern.FindSubmatch(body)
	if m == nil {
		return nil, fmt.Errorf("__NEXT_DATA__ script not found")
	}
	return m[1], nil
}

func hasNEXTData(body []byte) bool { return nextDataPattern.Match(body) }

// ParseGamePage decodes a game page into the whitelisted struct. Falls back
// to the JSON-LD ItemPage (name/url only) when __NEXT_DATA__ is missing or
// has no game object (PRD 22.6 / §4.9).
func ParseGamePage(body []byte) (*CGGame, bool, error) {
	if raw, err := extractNEXTData(body); err == nil {
		var doc struct {
			Props struct {
				PageProps struct {
					Game *CGGame `json:"game"`
				} `json:"pageProps"`
			} `json:"props"`
		}
		if err := json.Unmarshal(raw, &doc); err == nil && doc.Props.PageProps.Game != nil {
			doc.Props.PageProps.Game.CanonicalURL = canonicalURL(body)
			return doc.Props.PageProps.Game, true, nil
		}
	}
	if g := parseJSONLDItemPage(body); g != nil {
		return g, false, nil
	}
	return nil, false, fmt.Errorf("no game data on page")
}

// parseJSONLDItemPage extracts name and URL from the JSON-LD fallback.
func parseJSONLDItemPage(body []byte) *CGGame {
	for _, raw := range extractJSONLD(body) {
		var doc struct {
			Type  string            `json:"@type"`
			Name  string            `json:"name"`
			URL   string            `json:"url"`
			Graph []json.RawMessage `json:"@graph"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			continue
		}
		if strings.Contains(doc.Type, "ItemPage") || strings.Contains(doc.Type, "VideoGame") {
			return &CGGame{Name: doc.Name, Slug: slugFromGameURL(doc.URL), Status: "UNKNOWN"}
		}
		for _, item := range doc.Graph {
			var entry struct {
				Type string `json:"@type"`
				Name string `json:"name"`
				URL  string `json:"url"`
			}
			if err := json.Unmarshal(item, &entry); err != nil {
				continue
			}
			if strings.Contains(entry.Type, "VideoGame") {
				return &CGGame{Name: entry.Name, Slug: slugFromGameURL(entry.URL), Status: "UNKNOWN"}
			}
		}
	}
	return nil
}

func extractJSONLD(body []byte) []json.RawMessage {
	var out []json.RawMessage
	dec := html.NewTokenizer(strings.NewReader(string(body)))
	inLD := false
	var buf strings.Builder
	for {
		tt := dec.Next()
		if tt == html.ErrorToken {
			if dec.Err() == io.EOF {
				break
			}
			return out
		}
		switch tt {
		case html.StartTagToken:
			t := dec.Token()
			if t.Data == "script" {
				for _, a := range t.Attr {
					if a.Key == "type" && a.Val == "application/ld+json" {
						inLD = true
						buf.Reset()
					}
				}
			}
		case html.TextToken:
			if inLD {
				buf.Write(dec.Text())
			}
		case html.EndTagToken:
			if inLD && dec.Token().Data == "script" {
				inLD = false
				out = append(out, json.RawMessage(buf.String()))
			}
		}
	}
	return out
}

var gameURLPattern = regexp.MustCompile(`/game/([a-z0-9-]+)/?$`)

func slugFromGameURL(u string) string {
	m := gameURLPattern.FindStringSubmatch(strings.TrimSuffix(u, "/"))
	if m == nil {
		return ""
	}
	return m[1]
}

// ParseHotPage decodes /hot and returns the first 20 items in page order
// (PRD 22.9 / §4.9).
func ParseHotPage(body []byte) ([]CGGame, error) {
	raw, err := extractNEXTData(body)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Props struct {
			PageProps struct {
				Games struct {
					Items []CGGame `json:"items"`
				} `json:"games"`
			} `json:"pageProps"`
		} `json:"props"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	items := doc.Props.PageProps.Games.Items
	if len(items) > 20 {
		items = items[:20]
	}
	return items, nil
}

// SitemapEntry is one /game/ URL from the locale sitemap with its
// xhtml:link alternates.
type SitemapEntry struct {
	Slug       string
	LocaleURLs map[string]string // hreflang → URL
}

// SitemapIter streams the urlset and calls fn for every /game/ entry without
// loading the whole document (the real English sitemap is ~15 MB).
func SitemapIter(r io.Reader, fn func(SitemapEntry) error) error {
	dec := xml.NewDecoder(r)
	dec.Strict = true // a partial sitemap must never count as missing games
	var (
		inURL bool
		inLoc bool
		loc   strings.Builder
		cur   sitemapEntryBuf
	)
	// Compare on space + local: encoding/xml resolves prefixed names, so
	// image:loc would otherwise be indistinguishable from loc.
	for {
		tok, err := dec.Token()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch {
			case inSitemapNS(t.Name, "url"):
				inURL, cur, inLoc = true, sitemapEntryBuf{}, false
			case inSitemapNS(t.Name, "loc"):
				inLoc, loc = true, strings.Builder{}
			case t.Name.Local == "link" && t.Name.Space == xhtmlNS:
				if inURL {
					al := alternateLink{}
					for _, a := range t.Attr {
						if a.Name.Local == "hreflang" {
							al.Hreflang = a.Value
						}
						if a.Name.Local == "href" {
							al.Href = a.Value
						}
					}
					if al.Hreflang != "" && al.Href != "" {
						cur.alternates = append(cur.alternates, al)
					}
				}
			}
		case xml.CharData:
			if inLoc {
				loc.WriteString(strings.TrimSpace(string(t)))
			}
		case xml.EndElement:
			switch {
			case inSitemapNS(t.Name, "loc"):
				inLoc = false
				cur.loc = loc.String()
			case inSitemapNS(t.Name, "url"):
				inURL = false
				if m := gameURLPattern.FindStringSubmatch(cur.loc); m != nil {
					entry := SitemapEntry{Slug: m[1], LocaleURLs: map[string]string{}}
					for _, al := range cur.alternates {
						entry.LocaleURLs[al.Hreflang] = al.Href
					}
					if err := fn(entry); err != nil {
						return err
					}
				}
			}
		}
	}
}

// Namespaces used by the sitemap formats (urlset and sitemapindex).
const (
	sitemapNS = "http://www.sitemaps.org/schemas/sitemap/0.9"
	xhtmlNS   = "http://www.w3.org/1999/xhtml"
)

// inSitemapNS reports whether the name is `local` in the sitemap namespace;
// matching on space + local keeps image:loc from being confused with loc.
func inSitemapNS(n xml.Name, local string) bool {
	return n.Local == local && (n.Space == sitemapNS || n.Space == "")
}

// alternateLink is one xhtml:link hreflang alternate.
type alternateLink struct {
	Hreflang string
	Href     string
}

// sitemapEntryBuf accumulates one <url> element.
type sitemapEntryBuf struct {
	loc        string
	alternates []alternateLink
}

func canonicalURL(body []byte) string {
	t := html.NewTokenizer(strings.NewReader(string(body)))
	for {
		switch t.Next() {
		case html.ErrorToken:
			return ""
		case html.StartTagToken, html.SelfClosingTagToken:
			token := t.Token()
			if token.Data != "link" {
				continue
			}
			var rel, href string
			for _, attr := range token.Attr {
				if attr.Key == "rel" {
					rel = attr.Val
				}
				if attr.Key == "href" {
					href = attr.Val
				}
			}
			if rel == "canonical" {
				return href
			}
		}
	}
}

// plainText renders an HTML fragment as plain text for the reference store
// (22.6): block elements become newlines, entities are decoded by the
// tokenizer, script/style contents are dropped.
func plainText(fragment string) string {
	if fragment == "" {
		return ""
	}
	var b strings.Builder
	depth := 0 // inside script/style
	z := html.NewTokenizer(strings.NewReader(fragment))
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		switch tt {
		case html.StartTagToken:
			t := z.Token()
			if t.Data == "script" || t.Data == "style" {
				depth++
			}
			if isBlock(t.Data) {
				b.WriteString("\n")
			}
		case html.EndTagToken:
			t := z.Token()
			if t.Data == "script" || t.Data == "style" {
				if depth > 0 {
					depth--
				}
			}
			if isBlock(t.Data) {
				b.WriteString("\n")
			}
		case html.TextToken:
			if depth == 0 {
				b.Write(z.Text())
			}
		}
	}
	lines := strings.Split(b.String(), "\n")
	for i, line := range lines {
		lines[i] = strings.Join(strings.Fields(line), " ")
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func isBlock(tag string) bool {
	switch tag {
	case "p", "br", "div", "li", "tr", "ul", "ol", "table", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre":
		return true
	}
	return false
}
