# DeckView

[![Node.js](https://img.shields.io/badge/Node.js-20.19+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.22-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Latest-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-5.11-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Latest-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

> **Dashboard DevOps centralizado de código abierto.** Unifica pipelines y deployments desde Jenkins, Vercel, GitHub Actions, AWS ECS y Firebase — todo controlado en tu infraestructura local, sin dependencias de nube.

---

## Descripción

DeckView es un **dashboard DevOps self-hosted** diseñado para centralizar y monitorizar tus operaciones de CI/CD en un único lugar. 

### Características Principales

- Totalmente open source — Código completo disponible
- Ejecutable localmente — Corre íntegramente en tu infraestructura
- Sin dependencias externas — No requiere cuentas en servicios en la nube
- Multiplataforma — Soporta Jenkins, Vercel, GitHub Actions, AWS ECS, Firebase
- Fácil de desplegar — Docker Compose incluido

---

## Estructura del Proyecto

| Componente | Repositorio |
|---|---|
| **Backend** (API REST) | [DeckView](https://github.com/Jean-AT/DeckView) |
| **Frontend** (TypeScript/React) | [DeckViewWebApp](https://github.com/Jean-AT/DeckViewWebApp) |

---

## Requisitos Previos

- [Docker](https://docs.docker.com/get-docker/) y Docker Compose
- [Node.js](https://nodejs.org/) ≥ 20.19
- Git

---

## Inicio Rápido

### Backend

```bash
git clone https://github.com/Jean-AT/DeckView.git
cd DeckView
docker compose up --build
```

**Resultado:**
- API disponible en `http://localhost:3000`
- Health check: `http://localhost:3000/health`
- No requiere configuración previa (`.env` es opcional)

### Frontend

```bash
git clone https://github.com/Jean-AT/DeckViewWebApp.git
cd DeckViewWebApp
npm install
npm run dev
```

**Resultado:**
- Interfaz disponible en `http://localhost:5173`
- Proxy automático de `/api` hacia `localhost:3000`

### Seguridad Inicial

**Nota:** Cualquier usuario que se registre al inicio es **ADMINISTRADOR**. 

Para generar secretos seguros en producción:

```bash
./scripts/setup.sh
```

---

## Desarrollo Local (sin Docker)

Para desarrollar el backend sin contenedor:

```bash
# Inicia servicios de infraestructura en Docker
docker compose up -d postgres redis

# Configura variables de entorno
cp .env.example .env

# Instala dependencias y migra base de datos
npm ci
npx prisma migrate deploy

# Inicia servidor en modo desarrollo
npm run dev
```

---

## Configuración

### Variables de Entorno

Copia `.env.example` a `.env` solo si necesitas ajustar parámetros por defecto:

| Variable | Valor por Defecto (Desarrollo) | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto de la API |
| `CORS_ORIGINS` | `http://localhost:5173` | Orígenes permitidos |
| `SYNC_CRON_SCHEDULE` | `*/5 * * * *` | Schedule de sincronización (cron) |
| `WEBHOOK_SECRET` | Header `x-webhook-secret` | Secreto para validar webhooks |

### Producción

Para un servidor en producción:
1. Genera secretos propios usando `./scripts/setup.sh` o `openssl rand -hex 32`
2. Configura variables de entorno según tu infraestructura
3. Usa Docker Compose con volúmenes persistentes

---

## Stack Tecnológico

- **Backend:** Node.js 20.19+, TypeScript 5.9, Express 4.22
- **Frontend:** TypeScript, React
- **Base de Datos:** PostgreSQL
- **Cache:** Redis 5.11
- **Orquestación:** Docker, Docker Compose
- **ORM:** Prisma 6.19
- **Testing:** Node Built-in Test Runner
- **Linting:** ESLint 8.57, Prettier 3.9

---

## Licencia

Este proyecto está bajo licencia [MIT](./LICENSE).

---

## Contribuciones

Las contribuciones son bienvenidas. Siéntete libre de abrir issues o pull requests con mejoras.

---

## Contacto y Soporte

Para reportar bugs, sugerir features o hacer preguntas, abre un [issue](https://github.com/Jean-AT/DeckView/issues) en el repositorio.
