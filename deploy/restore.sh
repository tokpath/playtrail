#!/usr/bin/env bash
# Restore a backup produced by backup.sh (db.dump + media.tar.gz) into the
# running stack. The database is restored with --clean (drops and recreates).
# Usage: deploy/restore.sh <backup-dir>
set -euo pipefail

dir="${1:?usage: deploy/restore.sh <backup-dir>}"
db_dump="$dir/db.dump"
media_tar="$dir/media.tar.gz"
[[ -f "$db_dump" ]] || { echo "missing $db_dump" >&2; exit 1; }
[[ -f "$media_tar" ]] || { echo "missing $media_tar" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
compose="docker compose -f $here/docker-compose.yml --env-file $here/.env"

$compose exec -T postgres sh -c 'pg_restore --clean --if-exists --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' < "$db_dump"
$compose run --rm --no-deps --entrypoint sh api -c 'rm -rf /data/media/* && tar -xzf - -C /data/media' < "$media_tar"

echo "restored database and media from $dir"
