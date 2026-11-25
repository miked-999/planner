.PHONY: install dev build start test

UV := $(shell command -v uv || echo $(HOME)/.local/bin/uv)

install:
	$(UV) sync --directory backend
	npm --prefix frontend install

build:
	npm --prefix frontend run build

start: build
	$(UV) run --directory backend uvicorn app.main:app --host 127.0.0.1 --port 8000

dev-backend:
	$(UV) run --directory backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

dev-frontend:
	npm --prefix frontend run dev

test:
	$(UV) run --offline --directory backend pytest -v
	npm --prefix frontend test
