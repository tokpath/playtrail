#!/usr/bin/env bash
# PlayTrail e2e stack (ARCHITECTURE §9): reset the isolated e2e database,
# build + run api (e2e tag), fake-crazygames and the production web build on
# 127.0.0.1. Ports stay clear of the dev stack (3000/8081/8090/55432).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_PORT=8091 WEB_PORT=3100 FAKE_PORT=8095
API="http://127.0.0.1:${API_PORT}"
WEB="http://127.0.0.1:${WEB_PORT}"
FAKE="http://127.0.0.1:${FAKE_PORT}"
PG_CONTAINER="playtrail-dev-db"
DB_NAME="playtrail_e2e"
DSN="postgres://playtrail:playtrail@127.0.0.1:55432/playtrail_e2e?sslmode=disable"
INTERNAL_SECRET="e2e-internal-secret-0123456789abcdef0123456789abcdef"
ADMIN_EMAIL="e2e@playtrail.test"
ADMIN_PASSWORD="e2e-admin-password-0123456789"
BIN="$ROOT/backend/bin/playtrail-e2e"
FAKE_BIN="$ROOT/e2e/bin/fake-crazygames"
MEDIA_DIR="$ROOT/backend/data/media-e2e"
WEB_DIST=".next-e2e-dist"
PIDS="$ROOT/e2e/.pids"

api_env() { env DATABASE_URL="$DSN" API_ADDR="127.0.0.1:${API_PORT}" INTERNAL_SECRET="$INTERNAL_SECRET" \
  PUBLIC_BASE_URL="$WEB" WEB_INTERNAL_URL="$WEB" MEDIA_DIR="$MEDIA_DIR" \
  CRAWLER_ENABLED=true CRAWLER_BASE_URL="$FAKE" OPS_TIMEZONE=Asia/Taipei "$@"; }

wait_for() { # url name [tries]
  local url="$1" name="$2" tries="${3:-90}" i
  for ((i = 1; i <= tries; i++)); do
    if curl -sfL -o /dev/null --max-time 3 "$url"; then echo "e2e: $name ready"; return 0; fi
    sleep 1
  done
  echo "e2e: $name did not become ready at $url" >&2
  return 1
}

stop() {
  if [[ -d "$PIDS" ]]; then
    for f in web.pid api.pid fake.pid; do
      if [[ -f "$PIDS/$f" ]]; then
        pid=$(cat "$PIDS/$f")
        pkill -TERM -P "$pid" 2>/dev/null || true
        kill "$pid" 2>/dev/null || true
        rm -f "$PIDS/$f"
      fi
    done
    rmdir "$PIDS" 2>/dev/null || true
  fi
  echo "e2e: stack stopped"
}

kill_port() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; }

start() {
  stop || true
  # Orphaned listeners from an earlier crashed run would otherwise win the
  # port and serve a stale build; clear them before launching anything.
  kill_port "$API_PORT"
  kill_port "$WEB_PORT"
  kill_port "$FAKE_PORT"
  sleep 1
  mkdir -p "$PIDS"

  docker compose -f "$ROOT/deploy/docker-compose.dev.yml" up -d
  for i in $(seq 1 30); do
    docker exec "$PG_CONTAINER" pg_isready -U playtrail -q && break
    sleep 1
  done
  docker exec "$PG_CONTAINER" psql -X -U playtrail -d postgres -v ON_ERROR_STOP=1 -c \
    "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" -c "CREATE DATABASE \"$DB_NAME\";"
  echo "e2e: database $DB_NAME recreated"

  (cd "$ROOT/backend" && go build -tags e2e -o bin/playtrail-e2e ./cmd/playtrail)
  (cd "$ROOT/e2e/fake-crazygames" && go build -o "$FAKE_BIN" .)

  api_env "$BIN" migrate
  printf '%s\n' "$ADMIN_PASSWORD" | api_env "$BIN" admin-create --email "$ADMIN_EMAIL"
  api_env "$BIN" seed --file "$ROOT/e2e/fixtures/e2e-pack.json"

  "$FAKE_BIN" -addr "127.0.0.1:${FAKE_PORT}" -samples "$ROOT/e2e/fake-crazygames/samples" \
    > "$PIDS/fake.log" 2>&1 &
  echo $! > "$PIDS/fake.pid"

  api_env "$BIN" serve > "$PIDS/api.log" 2>&1 &
  echo $! > "$PIDS/api.pid"
  wait_for "$API/api/meta" "api"

  # NEXT_DIST_DIR keeps the e2e build away from web/.next so a running dev
  # server on :3000 is never clobbered.
  (cd "$ROOT/web" && env NEXT_DIST_DIR="$WEB_DIST" API_INTERNAL_URL="$API" \
    INTERNAL_SECRET="$INTERNAL_SECRET" PUBLIC_BASE_URL="$WEB" pnpm build > "$PIDS/web-build.log" 2>&1)
  # output: standalone: ship the static assets next to the standalone server
  # and run that single process so stop() can kill it.
  # With a custom distDir the standalone server reads its dist from
  # standalone/<distDir>/, so the static assets go there too.
  mkdir -p "$ROOT/web/$WEB_DIST/standalone/$WEB_DIST"
  rm -rf "$ROOT/web/$WEB_DIST/standalone/$WEB_DIST/static"
  cp -R "$ROOT/web/$WEB_DIST/static" "$ROOT/web/$WEB_DIST/standalone/$WEB_DIST/static"
  [[ -d "$ROOT/web/public" ]] && cp -R "$ROOT/web/public" "$ROOT/web/$WEB_DIST/standalone/public"
  (cd "$ROOT/web/$WEB_DIST/standalone" && env PORT="$WEB_PORT" HOSTNAME=127.0.0.1 \
    API_INTERNAL_URL="$API" INTERNAL_SECRET="$INTERNAL_SECRET" PUBLIC_BASE_URL="$WEB" \
    node server.js > "$PIDS/web.log" 2>&1 &
    echo $! > "$PIDS/web.pid")
  wait_for "$WEB/en/" "web"
  wait_for "$FAKE/_control" "fake-crazygames"
  echo "e2e: stack ready (api :$API_PORT, web :$WEB_PORT, fake :$FAKE_PORT)"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "usage: stack.sh start|stop" >&2; exit 2 ;;
esac
