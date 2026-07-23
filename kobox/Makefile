COMPOSE := docker compose -f docker/docker-compose.yml
EXEC := $(COMPOSE) exec kobox-dev bash -lc

.PHONY: up shell install test-int e2e down logs

up:
	$(COMPOSE) up -d --build
	@echo "waiting for systemd..." && sleep 3
	$(EXEC) 'systemctl is-system-running --wait || true'

shell:
	$(COMPOSE) exec kobox-dev bash

install:
	$(EXEC) 'cd /opt/KoBox/kobox && corepack enable pnpm && pnpm install --frozen-lockfile'

test-int: install
	$(EXEC) 'cd /opt/KoBox/kobox && pnpm test:int'

e2e: install
	$(EXEC) 'cd /opt/KoBox/kobox && pnpm build && pnpm test:e2e'

logs:
	$(COMPOSE) logs -f

down:
	$(COMPOSE) down -v
