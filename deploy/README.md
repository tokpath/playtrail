# PlayTrail production deployment

Docker Compose stack: Caddy (the only published ports), Next.js web, Go api,
Go worker, PostgreSQL 17, and a one-shot `migrate` job that api/worker wait
on. `/_internal/*` is answered with 404 at the edge and never leaves Caddy.

## First-time setup (VPS)

```sh
git clone <repo> && cd playtrail
cp deploy/.env.example deploy/.env
```

Edit `deploy/.env`:

- `SITE_ADDRESS=playtrail.example.com` — your domain; Caddy issues TLS
  certificates automatically (ports 80/443 must be reachable).
- `PUBLIC_BASE_URL=https://playtrail.example.com` — canonical origin.
- `POSTGRES_PASSWORD` and `INTERNAL_SECRET` (`openssl rand -base64 48`).
- Keep `CRAWLER_ENABLED=false` until you decide to enable the crawler.

Start the stack (migrations run automatically before api/worker start):

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Or with the Makefile wrappers: `make up`, `make logs`, `make down`.

### Create the first admin

Password is read from stdin, never from args or env:

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  run --rm -it api admin-create --email admin@example.com
```

### Seed initial content

The launch pack is mounted read-only; seeding goes through the real domain
functions, so publish gates apply:

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
  run --rm --no-deps -v "$(pwd)/content":/content:ro \
  api seed --file /content/launch-pack.json
```

## Cloudflare

Put Cloudflare in front of the VPS (proxied DNS record). The origin must be
reachable on ports 80/443 (`HTTP_PORT`/`HTTPS_PORT` in `deploy/.env`).
`TRUSTED_PROXY_HEADER=CF-Connecting-IP` (default in `.env.example`) makes the
api trust Cloudflare's client-IP header for private-network peers — do not
set it if Caddy is exposed directly.

**Origin firewall (required with `TRUSTED_PROXY_HEADER`)**: the header is only
trustworthy when the origin accepts traffic from Cloudflare alone. Restrict
inbound 80/443 (and 22 to your own addresses) to the Cloudflare IP ranges
published at <https://www.cloudflare.com/ips/> — e.g. with the VPS firewall
(`ufw default deny incoming; ufw allow from <range> to any port 80,443 proto tcp`
for each v4/v6 range, or a cloud security group). Anything bypassing Cloudflare
could otherwise spoof client IPs.

## Backups

Daily cron (keeps 14 days of dated directories under `deploy/backups/`):

```
0 4 * * * cd /srv/playtrail && deploy/backup.sh deploy/backups >> deploy/backups/backup.log 2>&1
```

Restore into the running stack (drops and recreates the database, replaces
media; the stack keeps running):

```sh
deploy/restore.sh deploy/backups/<timestamp>
```

Verify after restoring, e.g. `curl -s 'https://…/api/games?locale=en'`.

## Enabling the crawler

1. Set `CRAWLER_ENABLED=true` in `deploy/.env` and
   `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d`
   to recreate the worker.
2. Enable it from the admin panel (Settings → crawler), or
   `PATCH /api/admin/crawler`; caps and intervals live in `crawler_settings`.
