# DeckView

Dashboard DevOps self-hosted. Centraliza pipelines y deploys de Jenkins, Vercel, GitHub Actions, AWS ECS y Firebase.

Open source. Se corre entero en tu PC. Sin nube, sin cuentas externas para arrancar.

| Pieza | Repo |
|---|---|
| Backend (este repo) | https://github.com/Jean-AT/DeckView |
| Frontend | https://github.com/Jean-AT/DeckViewWebApp |

## Requisitos

- [Docker](https://docs.docker.com/get-docker/) y Docker Compose
- [Node.js](https://nodejs.org/) >= 20 (solo para el frontend)

## Arranque

### 1. Backend

```bash
git clone https://github.com/Jean-AT/DeckView.git
cd DeckView
docker compose up --build
```

No hace falta `.env`. API en http://localhost:3000 — health: http://localhost:3000/health

### 2. Frontend

```bash
git clone https://github.com/Jean-AT/DeckViewWebApp.git
cd DeckViewWebApp
npm install
npm run dev
```

UI en http://localhost:5173 (proxy `/api` → `localhost:3000`).

Todo usuario que se registre es **ADMIN**.

Para secretos aleatorios en el backend en vez de los de desarrollo:

```bash
./scripts/setup.sh
```

## Desarrollo (backend sin contenedor)

```bash
docker compose up -d postgres redis
cp .env.example .env
npm ci
npx prisma migrate deploy
npm run dev
```

## Configuración opcional

Copia `.env.example` a `.env` solo si quieres cambiar puertos, CORS o secretos.

| Variable | Default local |
|---|---|
| `PORT` | `3000` |
| `CORS_ORIGINS` | `http://localhost:5173` |
| `SYNC_CRON_SCHEDULE` | `*/5 * * * *` |
| `WEBHOOK_SECRET` | header `x-webhook-secret` |

En un servidor real, genera secretos propios (`./scripts/setup.sh` o `openssl rand`).

## Licencia

[MIT](./LICENSE)
# DeckView -- 
