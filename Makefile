SHELL := /bin/sh

.PHONY: help install test build verify preflight up live down logs health update clean

help:
	@printf '%s\n' \
	  'Friday commands:' \
	  '  make install    Install npm dependencies' \
	  '  make test       Run frontend, controller, and observer tests' \
	  '  make build      Type-check and build the production UI' \
	  '  make verify     Run tests, build, and validate Compose files' \
	  '  make preflight  Check VM 102 controller prerequisites without changing anything' \
	  '  make up         Start Friday using the base controller Compose configuration' \
	  '  make live       Start Friday with explicit local Docker read-only override' \
	  '  make down       Stop Friday' \
	  '  make logs       Follow Friday container logs' \
	  '  make health     Check health and overview endpoints' \
	  '  make update     Pull main and rebuild the VM 102 controller safely'

install:
	npm install --no-audit --no-fund

test:
	npm test

build:
	npm run build

verify: test build
	docker compose config >/dev/null
	docker compose -f compose.yaml -f compose.live.yaml config >/dev/null
	FRIDAY_OBSERVER_TOKEN=verify-token docker compose -f observer/compose.yaml config >/dev/null
	@echo 'Friday verification passed.'

preflight:
	sh scripts/preflight-controller.sh

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
	sh scripts/update-controller.sh

clean:
	rm -rf dist
