// Package media implements the upload pipeline (ARCHITECTURE §5): sniff the
// real content type, decode JPEG/PNG/WebP, re-encode to WebP at 320/640/1280
// (never upscaling), store files under MEDIA_DIR, and keep the row in
// media_assets. It also builds the public Image representation used by the
// read model.
package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gen2brain/webp"
	"golang.org/x/image/draw"

	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/httpx"
)

const (
	maxUploadBytes = 2 << 20
	webpQuality    = 80
)

var variantWidths = []int{320, 640, 1280}

// Service writes media files and asset rows.
type Service struct {
	Dir     string
	BaseURL string // PUBLIC_BASE_URL; public URLs are absolute against it
}

// Variant is one stored width variant. The path is relative to MEDIA_DIR.
type Variant struct {
	Width int    `json:"width"`
	Path  string `json:"path"`
}

// SrcsetEntry mirrors the public Image.srcset item.
type SrcsetEntry struct {
	URL   string `json:"url"`
	Width int    `json:"width"`
}

// Image is the public representation of a cover (ARCHITECTURE §6.1).
// Source tells the frontend which referrer policy to use and which URL to
// share; ShareURL is the 1200×630 share image.
type Image struct {
	URL      string        `json:"url"`
	Width    int           `json:"width"`
	Height   int           `json:"height"`
	Alt      string        `json:"alt"`
	Srcset   []SrcsetEntry `json:"srcset"`
	Source   string        `json:"source"` // "self" | "crazygames"
	ShareURL string        `json:"shareUrl"`
}

// crazyGamesHost is fixed by PRD 22.12; cover URLs are only ever built by
// the server-side template, never from raw external input.
const crazyGamesHost = "https://imgs.crazygames.com"

// CrazyGamesImage builds the hotlinked cover Image for a validated
// cover_source_path: url/srcset via the fixed template at 320/640/1280 and
// the 1200×630 cropped share URL.
func CrazyGamesImage(path, alt string) *Image {
	img := &Image{Alt: alt, Width: 1280, Height: 720, Source: "crazygames"}
	for _, w := range variantWidths {
		img.Srcset = append(img.Srcset, SrcsetEntry{URL: CrazyGamesURL(path, w), Width: w})
	}
	img.URL = CrazyGamesURL(path, 1280)
	img.ShareURL = crazyGamesHost + "/" + path + "?metadata=none&quality=85&width=1200&height=630&fit=crop"
	return img
}

// CrazyGamesURL renders one template URL at the given width.
func CrazyGamesURL(path string, width int) string {
	return fmt.Sprintf("%s/%s?metadata=none&quality=85&width=%d", crazyGamesHost, path, width)
}

func (s *Service) imageURL(path string) string { return s.BaseURL + "/media/" + path }

// IsPublic reports whether an asset may appear on the public site (PRD 8.1:
// rights_type original/licensed and review_state approved).
func IsPublic(a sqlc.MediaAsset) bool {
	return (a.RightsType == "original" || a.RightsType == "licensed") && a.ReviewState == "approved"
}

// ParseVariants decodes the variants jsonb column.
func ParseVariants(raw []byte) []Variant {
	var vs []Variant
	_ = json.Unmarshal(raw, &vs)
	return vs
}

// PublicImage builds the public Image for an asset with the given alt, or
// nil when the asset must not be shown publicly.
func (s *Service) PublicImage(a sqlc.MediaAsset, alt string) *Image {
	if !IsPublic(a) {
		return nil
	}
	variants := ParseVariants(a.Variants)
	if len(variants) == 0 {
		return nil
	}
	largest := variants[len(variants)-1]
	img := &Image{URL: s.imageURL(largest.Path), Alt: alt, Source: "self"}
	img.Width = largest.Width
	if largest.Width != int(a.Width) {
		img.Height = int(float64(largest.Width) * float64(a.Height) / float64(a.Width))
	} else {
		img.Height = int(a.Height)
	}
	for _, v := range variants {
		img.Srcset = append(img.Srcset, SrcsetEntry{URL: s.imageURL(v.Path), Width: v.Width})
	}
	// Own assets are 16:9; the largest variant doubles as the share image.
	img.ShareURL = img.URL
	return img
}

// ScreenshotsImage decodes a public_games.screenshots jsonb value.
func ScreenshotsImage(raw []byte) []Image {
	var imgs []Image
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &imgs)
	}
	return imgs
}

// CoverImage decodes a public_games.cover jsonb value.
func CoverImage(raw []byte) *Image {
	if len(raw) == 0 {
		return nil
	}
	var img Image
	if err := json.Unmarshal(raw, &img); err != nil || img.URL == "" {
		return nil
	}
	return &img
}

// Upload validates and stores one uploaded file, returning the asset row.
func (s *Service) Upload(ctx context.Context, q *sqlc.Queries, data []byte) (sqlc.MediaAsset, error) {
	if len(data) == 0 {
		return sqlc.MediaAsset{}, httpx.InvalidParam("file is empty")
	}
	if len(data) > maxUploadBytes {
		return sqlc.MediaAsset{}, httpx.PayloadTooLarge("file exceeds 2 MB")
	}
	switch ctype := http.DetectContentType(data[:min(512, len(data))]); {
	case strings.HasPrefix(ctype, "image/jpeg"):
	case strings.HasPrefix(ctype, "image/png"):
	case strings.HasPrefix(ctype, "image/webp"):
	default:
		return sqlc.MediaAsset{}, httpx.UnsupportedMediaType("only JPEG, PNG, and WebP are accepted")
	}

	src, _, err := decodeImage(data)
	if err != nil {
		return sqlc.MediaAsset{}, httpx.UnsupportedMediaType("file content does not decode as an image")
	}

	sum := sha256.Sum256(data)
	sha := hex.EncodeToString(sum[:])

	existing, err := q.GetMediaAssetBySHA256(ctx, sha)
	if err == nil {
		return existing, nil
	}

	bounds := src.Bounds()
	origW, origH := bounds.Dx(), bounds.Dy()
	if origW <= 0 || origH <= 0 {
		return sqlc.MediaAsset{}, httpx.UnsupportedMediaType("image has no pixels")
	}

	var variants []Variant
	for _, w := range variantWidths {
		if w >= origW {
			continue
		}
		h := int(float64(w) * float64(origH) / float64(origW))
		resized := resize(src, w, h)
		path, err := s.writeVariant(sha, w, resized)
		if err != nil {
			return sqlc.MediaAsset{}, err
		}
		variants = append(variants, Variant{Width: w, Path: path})
	}
	// The original width is always stored as the largest variant.
	{
		path, err := s.writeVariant(sha, origW, src)
		if err != nil {
			return sqlc.MediaAsset{}, err
		}
		variants = append(variants, Variant{Width: origW, Path: path})
	}
	variantsJSON, _ := json.Marshal(variants)

	return q.InsertMediaAsset(ctx, sqlc.InsertMediaAssetParams{
		Sha256:   sha,
		Width:    int32(origW),
		Height:   int32(origH),
		Variants: variantsJSON,
	})
}

func decodeImage(data []byte) (image.Image, string, error) {
	if img, err := jpeg.Decode(bytes.NewReader(data)); err == nil {
		return img, "jpeg", nil
	}
	if img, err := png.Decode(bytes.NewReader(data)); err == nil {
		return img, "png", nil
	}
	if img, err := webp.Decode(bytes.NewReader(data)); err == nil {
		return img, "webp", nil
	}
	return nil, "", fmt.Errorf("undecodable image")
}

func resize(src image.Image, w, h int) image.Image {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
	return dst
}

// writeVariant encodes one WebP file named {sha[:2]}/{sha}-{w}.webp.
func (s *Service) writeVariant(sha string, w int, img image.Image) (string, error) {
	path := fmt.Sprintf("%s/%s-%d.webp", sha[:2], sha, w)
	full := filepath.Join(s.Dir, path)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return "", fmt.Errorf("create media dir: %w", err)
	}
	var buf bytes.Buffer
	if err := webp.Encode(&buf, img, webp.Options{Quality: webpQuality}); err != nil {
		return "", fmt.Errorf("encode webp: %w", err)
	}
	if err := os.WriteFile(full, buf.Bytes(), 0o644); err != nil {
		return "", fmt.Errorf("write media file: %w", err)
	}
	return path, nil
}
