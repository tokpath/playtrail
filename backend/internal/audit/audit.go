// Package audit records every admin/system operation in audit_log (PRD 07).
package audit

import (
	"context"

	"github.com/google/uuid"

	sqlc "playtrail/backend/internal/db/sqlc"
)

// Entry describes one audited operation.
type Entry struct {
	AdminID    *uuid.UUID
	Actor      string // admin | system | crawler | import
	Action     string
	ObjectType string
	ObjectID   string
	Summary    []byte // JSON object
}

// Add writes one audit entry using the given queries (must already be inside
// the same transaction as the change it describes).
func Add(ctx context.Context, q *sqlc.Queries, e Entry) error {
	return q.InsertAuditLog(ctx, sqlc.InsertAuditLogParams{
		AdminID:    e.AdminID,
		Actor:      e.Actor,
		Action:     e.Action,
		ObjectType: e.ObjectType,
		ObjectID:   e.ObjectID,
		Summary:    e.Summary,
	})
}
