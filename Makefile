.PHONY: install check test migrate seed dev worker poll reconcile up down
install:
	npm ci
check:
	npm run typecheck
	npm run lint
	npm run format:check
test:
	npm test
migrate:
	npm run migrate
seed:
	npm run seed
dev:
	npm run dev
worker:
	npm run worker
poll:
	npm run poll
reconcile:
	npm run reconcile
up:
	docker compose up --build -d
down:
	docker compose down
