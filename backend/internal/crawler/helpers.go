package crawler

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func ptrTime(t time.Time) *time.Time { return &t }

func pgInt4Ptr(n int32) pgtype.Int4 { return pgtype.Int4{Int32: n, Valid: true} }

func pgBoolPtr(b bool) pgtype.Bool { return pgtype.Bool{Bool: b, Valid: true} }

func pgTextPtr(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func reasonIf(cond bool, reason string) string {
	if cond {
		return reason
	}
	return ""
}

func pgTextOpt(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func pgBoolOpt(b bool) pgtype.Bool { return pgtype.Bool{Bool: b, Valid: true} }

// pgDateOpt parses a CG date string (YYYY-MM-DD) into a nullable date.
func pgDateOpt(raw string) *time.Time {
	if raw == "" {
		return nil
	}
	if t, err := time.Parse("2006-01-02", raw); err == nil {
		return &t
	}
	return nil
}

func pgTimePtr(t *time.Time) *time.Time { return t }

func shortHash(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:16])
}
