// Command playtrail is the single backend binary: serve | worker | migrate |
// seed | admin-create | rebuild-public | crawl (ARCHITECTURE §1).
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"playtrail/backend/internal/config"
)

func main() {
	config.LoadDotEnv(".env")
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var err error
	switch os.Args[1] {
	case "serve":
		err = runServe(ctx)
	case "worker":
		err = runWorker(ctx)
	case "migrate":
		err = runMigrate(ctx)
	case "seed":
		err = runSeed(ctx)
	case "admin-create":
		err = runAdminCreate(ctx)
	case "rebuild-public":
		err = runRebuildPublic(ctx)
	case "crawl":
		err = runCrawl(ctx)
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "playtrail:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: playtrail serve|worker|migrate|seed|admin-create|rebuild-public|crawl --task <name> [flags]")
}
