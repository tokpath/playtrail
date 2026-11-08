#!/usr/bin/env bash
# Back up the production stack: PostgreSQL (custom format) + media volume
# into a dated directory, keeping the last 14 days.
# Usage: deploy/backup.sh [target-dir]   (Makefile default: deploy/backups)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose="docker compose -f $here/docker-compose.yml --env-file $here/.env"
target="${1:-backups}"
dest="$target/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dest"

# pg_dump runs inside the postgres container; credentials never leave it.
$compose exec -T postgres sh -c 'pg_dump --format=custom --username "$POSTGRES_USER" "$POSTGRES_DB"' > "$dest/db.dump"

# Stream the media volume through a one-off api container (busybox tar).
$compose run --rm --no-deps --entrypoint tar api -czf - -C /data/media . > "$dest/media.tar.gz"

# Retention: keep the last 14 days of dated backup directories.
find "$target" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +

echo "backup written to $dest"
