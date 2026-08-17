SHELL := /bin/sh

.PHONY: help install test build verify preflight up live down logs health update clean

help:
	@printf '%s\n' \
	  'Friday commands:' \
	  '  make install    Install npm dependencies' \
	  '  make test       Run frontend and backend tests' \
	  '  make build      Type-check and build the production UI' \
	  '  make verify     Run tests, build, and validate Compose files' \
	  '  make preflight  Check VM 100 prerequisites without changing anything' \
	  '  make up         Start Friday in safe/mock mode' \
	  '  make live       Start Friday with explicit live read-only adapters' \
	  '  make down       Stop Friday' \
	  '  make logs       Follow Friday container logs' \
	  '  make health     Check health and overview endpoints' \
	  '  make update     Pull current branch and rebuild safely'

install:
	npm install --no-audit --no-fund

test:
	npm test

build:
	npm run build

verify: test build
	docker compose config >/dev/null
	docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
	@echo 'Friday verification passed.'

preflight:
	sh scripts/preflight-vm100.sh

up:
	docker compose up -d --build

live:
	docker compose -f compose.yaml -f compose.live.yaml up -d --build

down:
	docker compose -f compose.yaml -f compose.live.yaml down

logs:
	docker compose logs -f --tail=200 friday

health:
	sh scripts/verify.sh

update:
	sh scripts/update-vm100.sh

clean:
	rm -rf dist
