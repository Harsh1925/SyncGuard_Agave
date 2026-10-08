.PHONY: install check test migrate seed api worker poll reconcile up down
install:
	python3 -m venv .venv
	.venv/bin/pip install -c requirements.lock -e '.[dev]'
check:
	.venv/bin/ruff check .
	.venv/bin/ruff format --check .
test:
	.venv/bin/pytest
migrate:
	.venv/bin/python -m syncguard.cli migrate
seed:
	.venv/bin/python -m syncguard.cli seed
api:
	.venv/bin/uvicorn syncguard.api.app:app --reload --port 8000
worker:
	.venv/bin/python -m syncguard.cli worker
poll:
	.venv/bin/python -m syncguard.cli poll
reconcile:
	.venv/bin/python -m syncguard.cli reconcile
up:
	docker compose up --build -d
down:
	docker compose down
