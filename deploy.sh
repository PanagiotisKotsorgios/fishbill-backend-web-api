#!/usr/bin/env bash
# =============================================================================
# FishBill — One-command production deploy
# Usage: ./deploy.sh
# =============================================================================
set -euo pipefail

ENV_FILE=".env.production"
DOCKER_ENV=".env"

# ── 1. Validate env file ──────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  echo "       Copy .env.production.example → .env.production and fill in all values."
  exit 1
fi

# Warn if any CHANGE_ME placeholder is still present
if grep -q "CHANGE_ME" "$ENV_FILE"; then
  echo "ERROR: $ENV_FILE still contains CHANGE_ME placeholders. Fill them in first."
  exit 1
fi

echo "==> Copying $ENV_FILE → $DOCKER_ENV (used by docker compose)"
cp "$ENV_FILE" "$DOCKER_ENV"

# ── 2. Pull latest code ───────────────────────────────────────────────────
echo "==> Pulling latest code from git"
git pull --ff-only

# ── 3. Build & restart containers ─────────────────────────────────────────
echo "==> Building images and restarting containers"
docker compose down --remove-orphans
docker compose up -d --build

# ── 4. Wait for API health check ──────────────────────────────────────────
echo "==> Waiting for API to become healthy..."
ATTEMPTS=0
MAX=30
until docker compose exec -T api wget -qO- http://localhost:4000/health > /dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [[ $ATTEMPTS -ge $MAX ]]; then
    echo "ERROR: API did not become healthy after ${MAX} attempts."
    echo "       Run 'docker compose logs api' to investigate."
    exit 1
  fi
  echo "  waiting... ($ATTEMPTS/$MAX)"
  sleep 5
done

echo ""
echo "✓ Deploy complete. FishBill is running."
echo "  Logs:  docker compose logs -f"
echo "  Shell: docker compose exec api sh"
