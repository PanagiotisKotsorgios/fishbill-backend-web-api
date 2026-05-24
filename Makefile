# =============================================================================
# FishBill — Docker convenience targets
# =============================================================================
.PHONY: deploy up down build logs shell db-shell backup ps migrate

# Full production deploy (validates .env.production, pulls, rebuilds, restarts)
deploy:
	bash deploy.sh

# Start containers in the background (without rebuilding)
up:
	docker compose up -d

# Stop all containers
down:
	docker compose down

# Rebuild images without restarting
build:
	docker compose build

# Copy .env.production → .env (needed before first deploy on bare Docker)
env-init:
	@test -f .env.production || (echo "ERROR: .env.production not found. Copy .env.production.example and fill it in."; exit 1)
	cp .env.production .env
	@echo ".env ready."

# Stream logs from all containers (Ctrl-C to stop)
logs:
	docker compose logs -f

# Stream logs from the API container only
logs-api:
	docker compose logs -f api

# Open a shell inside the API container
shell:
	docker compose exec api sh

# Open a MySQL shell as root
db-shell:
	docker compose exec db mysql -uroot -p$$DB_ROOT_PASSWORD fishbill_db

# Show running containers and their status
ps:
	docker compose ps

# Run database migrations manually (normally runs automatically on start)
migrate:
	docker compose exec api node scripts/migrate.js

# Take a manual database backup (saves to api_backups volume)
backup:
	docker compose exec api node scripts/backup.js 2>/dev/null || \
	  docker compose exec db mysqldump -uroot -p$$DB_ROOT_PASSWORD fishbill_db \
	    | gzip > "backup_$$(date +%Y%m%d_%H%M%S).sql.gz" && \
	  echo "Backup saved to backup_$$(date +%Y%m%d_%H%M%S).sql.gz"

# Tail the server error log
error-log:
	docker compose exec api tail -f logs/error.log 2>/dev/null || \
	  docker compose logs --tail=100 api

# Hard reset: stop, remove volumes (ALL DATA LOST), rebuild from scratch
reset-all:
	@echo "WARNING: This will delete all data including the database."
	@read -p "Type YES to continue: " confirm && [ "$$confirm" = "YES" ]
	docker compose down -v --remove-orphans
	docker compose up -d --build
