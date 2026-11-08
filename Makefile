COMPOSE_PROD := docker compose -f deploy/docker-compose.yml --env-file deploy/.env

.PHONY: dev-db dev-db-down migrate api worker web seed lint build up down logs backup

dev-db:
	docker compose -f deploy/docker-compose.dev.yml up -d

dev-db-down:
	docker compose -f deploy/docker-compose.dev.yml down

migrate:
	cd backend && go run ./cmd/playtrail migrate

api:
	cd backend && go run ./cmd/playtrail serve

worker:
	cd backend && go run ./cmd/playtrail worker

web:
	cd web && pnpm dev

seed:
	cd backend && go run ./cmd/playtrail seed --file $(PACK)

lint:
	cd backend && gofmt -l . && go vet ./... && golangci-lint run

build:
	cd backend && go build -o bin/playtrail ./cmd/playtrail

# Production stack. Local run: SITE_ADDRESS=:8080 (see deploy/.env.example).
up:
	$(COMPOSE_PROD) up -d --build

down:
	$(COMPOSE_PROD) down

logs:
	$(COMPOSE_PROD) logs -f --tail=100

backup:
	deploy/backup.sh deploy/backups

# E2E acceptance suite (PRD 13): stack start -> playwright -> stack stop.
.PHONY: e2e
e2e:
	@bash e2e/scripts/stack.sh start || { bash e2e/scripts/stack.sh stop; exit 1; }
	@cd e2e && pnpm install --silent; rc=0; pnpm exec playwright test || rc=$$?; \
		cd .. && bash e2e/scripts/stack.sh stop; exit $$rc
