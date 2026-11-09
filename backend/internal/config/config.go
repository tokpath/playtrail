// Package config parses runtime configuration from environment variables (ARCHITECTURE §2).
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL        string
	APIAddr            string
	PublicBaseURL      string
	WebInternalURL     string
	InternalSecret     string
	MediaDir           string
	OpsTimezone        *time.Location
	SupportedLocales   []string
	DefaultLocale      string
	LocaleMinGames     int
	SessionIdleTimeout time.Duration

	// TrustedProxyHeader names the header carrying the real client IP
	// (e.g. CF-Connecting-IP behind Cloudflare). Empty = trust RemoteAddr
	// only. Honored only when the request comes from loopback/private.
	TrustedProxyHeader    string
	ExternalCoversEnabled bool

	CrawlerEnabled        bool
	CrawlerUserAgent      string
	CrawlerDailyCap       int
	CrawlerMinInterval    time.Duration
	CrawlerObservedRegion string
	HotAutoPublish        bool
}

// LoadDotEnv reads KEY=VALUE lines from path into the environment without
// overriding variables that are already set.
func LoadDotEnv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if _, exists := os.LookupEnv(key); !exists && key != "" {
			_ = os.Setenv(key, value)
		}
	}
}

func get(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getRequired(key string) (string, error) {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return "", fmt.Errorf("missing required environment variable %s", key)
	}
	return v, nil
}

func getInt(key string, def int) (int, error) {
	v := get(key, strconv.Itoa(def))
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	return n, nil
}

func getBool(key string, def bool) bool {
	v := get(key, strconv.FormatBool(def))
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

// Load parses all configuration variables. requireInternal enforces the
// INTERNAL_SECRET checks needed by serve and worker.
func Load(requireInternal bool) (*Config, error) {
	dbURL, err := getRequired("DATABASE_URL")
	if err != nil {
		return nil, err
	}
	cfg := &Config{
		DatabaseURL:        dbURL,
		APIAddr:            get("API_ADDR", ":8081"),
		PublicBaseURL:      get("PUBLIC_BASE_URL", "http://localhost:3000"),
		WebInternalURL:     get("WEB_INTERNAL_URL", "http://localhost:3000"),
		MediaDir:           get("MEDIA_DIR", "./data/media"),
		DefaultLocale:      get("DEFAULT_LOCALE", "en"),
		LocaleMinGames:     10,
		SessionIdleTimeout: 30 * time.Minute,
	}

	cfg.InternalSecret = os.Getenv("INTERNAL_SECRET")
	if requireInternal && cfg.InternalSecret == "" {
		return nil, fmt.Errorf("missing required environment variable INTERNAL_SECRET")
	}
	if cfg.InternalSecret != "" && len(cfg.InternalSecret) < 32 {
		return nil, fmt.Errorf("INTERNAL_SECRET must be at least 32 bytes")
	}

	tz, err := time.LoadLocation(get("OPS_TIMEZONE", "Asia/Taipei"))
	if err != nil {
		return nil, fmt.Errorf("invalid OPS_TIMEZONE: %w", err)
	}
	cfg.OpsTimezone = tz

	locales := get("SUPPORTED_LOCALES", "en,zh")
	for _, l := range strings.Split(locales, ",") {
		l = strings.TrimSpace(l)
		if l != "" {
			cfg.SupportedLocales = append(cfg.SupportedLocales, l)
		}
	}
	if len(cfg.SupportedLocales) == 0 {
		return nil, fmt.Errorf("SUPPORTED_LOCALES must not be empty")
	}

	if cfg.LocaleMinGames, err = getInt("LOCALE_MIN_GAMES", 10); err != nil {
		return nil, err
	}
	if cfg.SessionIdleTimeout, err = time.ParseDuration(get("SESSION_IDLE_TIMEOUT", "30m")); err != nil {
		return nil, fmt.Errorf("invalid SESSION_IDLE_TIMEOUT: %w", err)
	}
	if cfg.CrawlerDailyCap, err = getInt("CRAWLER_DAILY_CAP", 3000); err != nil {
		return nil, err
	}
	if cfg.CrawlerMinInterval, err = time.ParseDuration(get("CRAWLER_MIN_INTERVAL", "2s")); err != nil {
		return nil, fmt.Errorf("invalid CRAWLER_MIN_INTERVAL: %w", err)
	}

	cfg.TrustedProxyHeader = get("TRUSTED_PROXY_HEADER", "")
	cfg.ExternalCoversEnabled = getBool("EXTERNAL_COVERS_ENABLED", true)
	cfg.CrawlerEnabled = getBool("CRAWLER_ENABLED", false)
	cfg.CrawlerUserAgent = get("CRAWLER_USER_AGENT", "PlayTrailBot/1.0 (+"+cfg.PublicBaseURL+"/en/about)")
	cfg.CrawlerObservedRegion = get("CRAWLER_OBSERVED_REGION", "TW")
	cfg.HotAutoPublish = getBool("HOT_AUTO_PUBLISH", true)

	return cfg, nil
}

// SecureCookie reports whether session cookies should carry the Secure flag,
// based on the scheme of PUBLIC_BASE_URL.
func (c *Config) SecureCookie() bool {
	return strings.HasPrefix(strings.ToLower(c.PublicBaseURL), "https://")
}
