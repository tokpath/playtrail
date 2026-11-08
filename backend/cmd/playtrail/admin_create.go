package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"playtrail/backend/internal/auth"
	sqlc "playtrail/backend/internal/db/sqlc"
	"playtrail/backend/internal/validate"
)

// runAdminCreate creates the initial administrator. The email comes from the
// --email flag; the password is read from stdin — never from args or env
// (TECH-STACK §7).
func runAdminCreate(ctx context.Context) error {
	fs := flag.NewFlagSet("admin-create", flag.ContinueOnError)
	email := fs.String("email", "", "administrator email (required)")
	if err := fs.Parse(os.Args[2:]); err != nil {
		return err
	}
	if *email == "" {
		return errors.New("--email is required")
	}
	fmt.Fprint(os.Stderr, "Enter password (min 12 characters): ")
	password, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && password == "" {
		return fmt.Errorf("read password from stdin: %w", err)
	}
	password = strings.TrimRight(password, "\r\n")
	if n := validate.Len(password); n < 12 || n > 200 {
		return errors.New("password must be 12-200 characters")
	}

	cfg, err := loadConfig(false)
	if err != nil {
		return err
	}
	pool, err := dbOpen(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	admin, err := sqlc.New(pool).InsertAdmin(ctx, sqlc.InsertAdminParams{
		Email:        *email,
		PasswordHash: auth.HashPassword(password),
	})
	if err != nil {
		return fmt.Errorf("create admin: %w", err)
	}
	fmt.Fprintf(os.Stderr, "admin %s created\n", admin.Email)
	return nil
}
