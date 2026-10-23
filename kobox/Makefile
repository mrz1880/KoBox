COMPOSE := docker compose -f docker/docker-compose.yml
EXEC := $(COMPOSE) exec kobox-dev bash -lc
IN_REPO := cd /opt/KoBox/kobox
PNPM_INSTALL := corepack enable pnpm && pnpm install --frozen-lockfile

.PHONY: up shell install test-int e2e e2e-full down logs

up:
	$(COMPOSE) up -d --build
	./docker/wait-for-systemd.sh

shell:
	$(COMPOSE) exec kobox-dev bash

install:
	$(EXEC) '$(IN_REPO) && $(PNPM_INSTALL)'

test-int: install
	$(EXEC) '$(IN_REPO) && pnpm test:int'

e2e: install
	$(EXEC) '$(IN_REPO) && pnpm build && pnpm test:e2e'

# The whole container suite from scratch, as the CI runs it, then teardown even
# on failure. The compose project and container names are fixed: this replaces
# a kobox-dev already started from another checkout.
e2e-full:
	trap '$(COMPOSE) down -v' EXIT; \
	$(COMPOSE) up -d --build && \
	./docker/wait-for-systemd.sh && \
	$(EXEC) '$(IN_REPO) && $(PNPM_INSTALL) && pnpm test:int && pnpm build && pnpm test:e2e'

logs:
	$(COMPOSE) logs -f

down:
	$(COMPOSE) down -v
