#!/bin/sh
set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo ".env already exists, skipping secret generation."
else
  echo "Creating .env with random secrets..."
  if command -v openssl >/dev/null 2>&1; then
    JWT_SECRET=$(openssl rand -hex 32)
    JWT_REFRESH_SECRET=$(openssl rand -hex 32)
    CREDENTIALS_MASTER_KEY=$(openssl rand -base64 32)
    WEBHOOK_SECRET=$(openssl rand -hex 24)
  else
    echo "openssl not found; copying .env.example (local-dev secrets)."
    cp .env.example .env
    exec docker compose up --build "$@"
  fi

  cat > .env <<EOF
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/devops_dashboard
REDIS_URL=redis://localhost:6379
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
CREDENTIALS_MASTER_KEY=${CREDENTIALS_MASTER_KEY}
SYNC_CRON_SCHEDULE=*/5 * * * *
OUTBOUND_RATE_LIMIT_PER_MINUTE=30
WEBHOOK_SECRET=${WEBHOOK_SECRET}
CORS_ORIGINS=http://localhost:5173
EOF
  echo "Created .env"
fi

exec docker compose up --build "$@"
