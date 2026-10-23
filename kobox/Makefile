# One compose project per checkout, named after the checkout directory: up and
# down in one worktree never recreate or destroy another worktree's containers.
# Compose project names allow only lowercase letters, digits, '_' and '-'.
export COMPOSE_PROJECT_NAME := kobox-$(shell basename "$(abspath $(CURDIR)/..)" \
	| tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_\n-' '-')
COMPOSE := docker compose -f docker/docker-compose.yml
EXEC := $(COMPOSE) exec kobox-dev bash -lc
IN_REPO := cd /opt/KoBox/kobox

.PHONY: up shell install test-int e2e e2e-full down logs

up:
	$(COMPOSE) up -d --build
	./docker/wait-for-systemd.sh

shell:
	$(COMPOSE) exec kobox-dev bash

install:
	$(EXEC) '$(IN_REPO) && corepack enable pnpm && pnpm install --frozen-lockfile'

test-int: install
	$(EXEC) '$(IN_REPO) && pnpm test:int'

e2e: install
	$(EXEC) '$(IN_REPO) && pnpm build && pnpm test:e2e'

# The whole container suite from scratch, as the CI runs it, then teardown even
# on failure.
e2e-full:
	trap '$(MAKE) down' EXIT; $(MAKE) up test-int e2e

logs:
	$(COMPOSE) logs -f

down:
	$(COMPOSE) down -v
