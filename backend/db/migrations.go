// Package migrations embeds the goose SQL migration files so the binary
// carries its own schema (ADR A5). The directory layout follows
// ARCHITECTURE §1: db/migrations holds the SQL, db/queries the sqlc queries.
package migrations

import "embed"

//go:embed migrations/*.sql
var FS embed.FS
