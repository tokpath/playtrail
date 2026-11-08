// Package validate holds every server-side field rule: lengths counted in
// Unicode code points, enum values, URL whitelists, and time checks (PRD §8,
// TECH-STACK §3).
package validate

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"playtrail/backend/internal/httpx"
)

// Len returns the length of s in code points.
func Len(s string) int { return utf8.RuneCountInString(s) }

// LenField checks a code-point length range; min 0 means optional.
func LenField(field, s string, min, max int) error {
	n := Len(s)
	if n < min || n > max {
		return httpx.Validation(map[string]string{field: fmt.Sprintf("length must be %d-%d code points", min, max)})
	}
	return nil
}

// EnumField checks membership in an enum.
func EnumField(field, s string, allowed ...string) error {
	for _, a := range allowed {
		if s == a {
			return nil
		}
	}
	return httpx.Validation(map[string]string{field: fmt.Sprintf("must be one of: %s", strings.Join(allowed, ", "))})
}

// RequiredField rejects empty values.
func RequiredField(field, s string) error {
	if strings.TrimSpace(s) == "" {
		return httpx.Validation(map[string]string{field: "required"})
	}
	return nil
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-+[a-z0-9]+)*$`)

// SlugOK validates the game/tag/category slug shape (length ≤ 100, lowercase
// letters, digits, hyphens).
func SlugOK(slug string) bool {
	return len(slug) <= 100 && slugPattern.MatchString(slug)
}

// SlugField validates a slug field.
func SlugField(field, slug string) error {
	if !SlugOK(slug) {
		return httpx.Validation(map[string]string{field: "must match [a-z0-9] and hyphens, max 100 chars"})
	}
	return nil
}

// GameSlug derives a site slug from a game name.
func GameSlugFromName(name string) string {
	var b strings.Builder
	lastHyphen := false
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastHyphen = false
		} else if !lastHyphen && b.Len() > 0 {
			b.WriteByte('-')
			lastHyphen = true
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		slug = "game"
	}
	if len(slug) > 100 {
		slug = strings.TrimRight(slug[:100], "-")
	}
	return slug
}

const gameHost = "www.crazygames.com"

var gamePathPattern = regexp.MustCompile(`^/game/([A-Za-z0-9-]+)$`)

// NormalizeGameURL applies the external link whitelist (PRD 8.4): HTTPS,
// host exactly www.crazygames.com, path /game/{slug} (the English address;
// the database only stores the English URL). Query and fragment are stripped
// and the canonical URL is saved; everything else (credentials, other hosts
// or schemes, non-default ports, encoded slashes, dot segments, extra path
// segments) is rejected.
func NormalizeGameURL(field, raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil || u.Opaque != "" {
		return "", httpx.Validation(map[string]string{field: "not a valid external game URL"})
	}
	if u.Scheme != "https" {
		return "", httpx.Validation(map[string]string{field: "scheme must be https"})
	}
	if u.Port() != "" {
		return "", httpx.Validation(map[string]string{field: "only the default 443 port is allowed"})
	}
	if strings.ToLower(u.Host) != gameHost {
		return "", httpx.Validation(map[string]string{field: "host must be www.crazygames.com"})
	}
	path := strings.TrimSuffix(u.Path, "/")
	m := gamePathPattern.FindStringSubmatch(path)
	if m == nil {
		return "", httpx.Validation(map[string]string{field: "path must be /game/{slug}"})
	}
	slug := m[1]
	if strings.Contains(slug, "%") || strings.Contains(slug, "\\") {
		return "", httpx.Validation(map[string]string{field: "encoded or invalid characters in game slug"})
	}
	return "https://" + gameHost + "/game/" + slug, nil
}

// HTTPSField checks that a source/evidence URL is https (not full whitelist;
// these are only displayed, never fetched).
func HTTPSField(field, raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return "", httpx.Validation(map[string]string{field: "must be an https URL"})
	}
	return u.String(), nil
}

// TimeField parses an RFC 3339 time that must not be in the future relative
// to now and, when maxAge > 0, not older than now-maxAge.
func TimeField(field string, raw string, now time.Time, maxAge time.Duration, optional bool) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		if optional {
			return time.Time{}, nil
		}
		return time.Time{}, httpx.Validation(map[string]string{field: "required"})
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, httpx.Validation(map[string]string{field: "must be RFC 3339 with offset"})
	}
	if t.After(now) {
		return time.Time{}, httpx.Validation(map[string]string{field: "cannot be in the future"})
	}
	if maxAge > 0 && t.Before(now.Add(-maxAge)) {
		return time.Time{}, httpx.Validation(map[string]string{field: fmt.Sprintf("older than %d days", int(maxAge.Hours()/24))})
	}
	return t, nil
}

// OptionalTimeField parses an RFC 3339 time when present; nil or empty means
// "not provided". Future times are rejected, like everywhere else.
func OptionalTimeField(field string, raw *string, now time.Time) (*time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	t, err := TimeField(field, *raw, now, 0, false)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

var coverSourcePathPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$`)

// CoverSourcePathField validates a CrazyGames cover path (PRD 22.12):
// relative path segments only, max 200 chars, no "..", no leading/trailing
// slash. An empty value clears the path.
func CoverSourcePathField(field, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	if len(raw) > 200 || strings.Contains(raw, "..") || strings.HasPrefix(raw, "/") || strings.HasSuffix(raw, "/") || !coverSourcePathPattern.MatchString(raw) {
		return "", httpx.Validation(map[string]string{field: `must be a relative path of [A-Za-z0-9_-] segments, max 200, no ".."`})
	}
	return raw, nil
}

// EscapeLike escapes the LIKE wildcards in a literal substring search (PRD 10).
func EscapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
