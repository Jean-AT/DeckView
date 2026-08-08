# Plan de Implementación: Plataforma de Gestión de Proyectos DevOps Interna

## 1. Descripción General

Dashboard interno que centraliza el estado de pipelines, builds y despliegues de múltiples proveedores (Jenkins, Vercel, GitHub Actions/Pages, AWS, Firebase) en una sola interfaz, con gestión de tickets/incidentes y control de acceso por roles.

**Objetivo:** eliminar la necesidad de revisar cada plataforma por separado para saber "¿qué está pasando con mis proyectos?".

**Alcance de este plan:** solo el **BACKEND** completo (API REST + jobs de sincronización + gestión de credenciales/API keys de proveedores + tickets), terminado y testeado. El frontend se planifica en un documento separado una vez el backend esté completo.

---

## 2. Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Backend | Node.js + TypeScript, Express |
| ORM / DB | Prisma + PostgreSQL |
| Auth | JWT + bcrypt, roles (admin / developer / viewer) |
| Frontend | React + TypeScript + Vite |
| Data fetching frontend | TanStack Query (React Query) |
| Gráficas | Recharts |
| Estilos | Tailwind CSS |
| Cache / colas | Redis (cliente: `ioredis`) |
| Contenedores | Docker + Docker Compose |
| CI/CD del propio proyecto | Jenkins |
| Notificaciones en tiempo real | Socket.io (opcional, fase avanzada) |

**Layout del repositorio:** este repositorio contiene SOLO el **backend** (config en la raíz: `package.json`, `tsconfig.json`, `src/`, `test/`, `prisma/`). El frontend (React + Vite + TypeScript) vive en un proyecto/repositorio separado.

**Alcance actual (fase backend):** este plan cubre solo el backend, incluyendo un módulo para ingresar y guardar de forma cifrada las API keys de **Vercel, Jenkins, GitHub y AWS**. React/Vite/TanStack Query/Recharts/Tailwind se implementan en el proyecto frontend separado (Fase 11).

### 2.1 Política de dependencias — paquetes prohibidos (supply-chain)

**Contexto:** en agosto de 2026 se detectó un *supply-chain worm* en npm que comprometió al menos 444 paquetes (1381 versiones) con más de 2 mil millones de instalaciones mensuales combinadas. Estos paquetes quedan **PROHIBIDOS** como dependencia directa o transitiva del proyecto:

| Paquete | Instalaciones/mes |
|---|---|
| `keyv` 6.0.0 | 604M |
| `flat-cache` 6.1.24 | 580M |
| `file-entry-cache` 11.1.6 | 571M |
| `cacheable-request` 13.0.20 | 137M |
| `@cacheable/utils` 2.5.1 | 34M |
| `cacheable` 2.5.1 | 30M |
| `@cacheable/memory` 2.2.1 | 28M |
| `cache-manager` 7.2.10 | 16M |
| `@cacheable/node-cache` 3.1.2 | 6M |
| `ecto` 5.0.1 | 4.5K |
| `@cacheable/net` 2.1.1 | 3.7K |
| `@deliveroo/reevent` 1.0.1 | — |
| `@or-sdk/invitations` 1.4.9 | — |
| `@picsart/ai-sdk` 3.32.2 | — |
| `@qlik/embed-runtime` 1.6.4 | — |
| `picasso.js` 2.11.6 | — |

**Reglas de enforcement:**

1. **Lockfile commiteado:** `package-lock.json` (o `npm-shrinkwrap.json`) siempre versionado; nunca `npm install` a ciegas desde `package.json`.
2. **`npm overrides`** en el `package.json` raíz para forzar versiones parcheadas/sanas de `keyv`, `flat-cache` y `file-entry-cache` si alguna herramienta (p. ej. ESLint) las necesita transitivamente.
3. **Check en CI sobre el lockfile:** script que hace `grep` de los nombres prohibidos → falla el build si aparece cualquiera.
4. **`npm audit` (o `osv-scanner`)** como stage obligatorio antes de `build` (ver Fase 8 / `Jenkinsfile`).

**Decisiones de stack para no reintroducir estos paquetes:**

- **HTTP client de los adaptadores** (Secciones 5/6): usar `fetch` nativo (undici) o `axios`. **PROHIBIDO `got`** (arrastra `cacheable-request`/`cacheable`/`keyv`).
- **Redis:** usar `ioredis` directamente. **PROHIBIDO** `cache-manager`, `@cacheable/*` y cualquier capa de abstracción de cache.
- **ESLint:** pinear versión y validar en CI que su árbol no contenga `flat-cache`/`file-entry-cache`/`keyv`.
- Recharts para gráficas es seguro (no depende de `picasso.js` ni `@qlik/embed-runtime`).

---

## 3. Arquitectura de Infraestructura

```
                        ┌─────────────────────┐
                        │      Frontend        │
                        │   React + Vite (SPA)  │
                        └──────────┬───────────┘
                                   │ HTTPS / REST
                        ┌──────────▼───────────┐
                        │       Backend         │
                        │  Node.js + TypeScript │
                        │  (Express + Prisma)   │
                        └──────────┬───────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
      ┌───────▼──────┐    ┌────────▼────────┐   ┌────────▼────────┐
      │  PostgreSQL   │    │      Redis       │   │  Job Scheduler   │
      │  (datos core) │    │ (cache/colas)    │   │ (polling cron)   │
      └───────────────┘    └─────────────────┘   └────────┬────────┘
                                                            │
                        ┌───────────────────────────────────┼───────────────────────────────────┐
                        │                                    │                                    │
                ┌───────▼───────┐  ┌───────────┐  ┌──────────▼─────┐  ┌────────────┐  ┌───────────▼─┐
                │    Jenkins     │  │  Vercel    │  │  GitHub Actions │  │    AWS     │  │   Firebase   │
                │   REST API     │  │  REST API  │  │   REST API      │  │  SDK (v3)  │  │  Admin SDK   │
                └────────────────┘  └───────────┘  └────────────────┘  └────────────┘  └──────────────┘
```

**Idea clave:** el backend nunca consulta las APIs externas en tiempo real cuando el usuario carga el dashboard. Un **job scheduler** (cron interno o worker separado) hace *polling* periódico (o recibe *webhooks*), guarda los resultados en PostgreSQL, y el frontend siempre lee de tu propia base de datos. Esto da:

- Historial real (las APIs externas no siempre guardan histórico largo)
- Velocidad (no esperas a 5 APIs externas cada vez que alguien abre el dashboard)
- Resiliencia (si una API externa está caída, tu dashboard sigue mostrando el último estado conocido)

### Despliegue de la infraestructura propia

- **Backend + Frontend:** contenedores Docker, desplegados en una VM (EC2) o en un servicio tipo Render/Railway para el ambiente de portfolio. Para "modo empresa" real, ECS o Kubernetes.
- **PostgreSQL:** RDS si vas full AWS, o un contenedor Docker con volumen persistente para desarrollo/portfolio.
- **Redis:** contenedor Docker o ElastiCache en AWS.
- **Jenkins:** instancia propia (Docker o VM) que construye y despliega el proyecto (lint → test → build → docker build → push → deploy).

---

## 4. Modelo de Datos (Prisma, simplificado)

```prisma
model User {
  id        String   @id @default(uuid())
  name      String
  email     String   @unique
  password  String
  role      Role     @default(VIEWER)
  createdAt DateTime @default(now())
}

enum Role {
  ADMIN
  DEVELOPER
  VIEWER
}

model Project {
  id             String    @id @default(uuid())
  name           String
  repoUrl        String?
  provider       Provider
  providerConfig Json      // ej: { jobName: "backend-api" } o { vercelProjectId: "prj_xxx" }
  deployments    Deployment[]
  tickets        Ticket[]
  credentials    ProviderCredential[]
}

enum Provider {
  JENKINS
  VERCEL
  GITHUB_ACTIONS
  AWS
  FIREBASE
}

model ProviderCredential {
  id             String   @id @default(uuid())
  project        Project  @relation(fields: [projectId], references: [id])
  projectId      String
  provider       Provider @unique // una credencial por proveedor y proyecto
  valueCiphertext String  // AES-256-GCM
  valueIv        String
  valueTag       String
  maskedPreview  String   // ej: "vercel_••••ab12"
  isValid        Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  rotatedAt      DateTime?
}

model Deployment {
  id         String   @id @default(uuid())
  project    Project  @relation(fields: [projectId], references: [id])
  projectId  String
  provider   Provider
  status     Status
  commitSha  String?
  url        String?
  logUrl     String?
  durationMs Int?
  startedAt  DateTime
  finishedAt DateTime?
}

enum Status {
  SUCCESS
  FAILED
  RUNNING
  CANCELLED
  QUEUED
}

model Ticket {
  id           String   @id @default(uuid())
  project      Project  @relation(fields: [projectId], references: [id])
  projectId    String
  deploymentId String?
  title        String
  description  String?
  priority     Priority @default(MEDIUM)
  status       TicketStatus @default(OPEN)
  assignedTo   String?
  createdAt    DateTime @default(now())
}

enum Priority { LOW MEDIUM HIGH CRITICAL }
enum TicketStatus { OPEN IN_PROGRESS RESOLVED CLOSED }
```

---

## 5. Patrón de Integración: `DeploymentProvider`

Cada plataforma externa se implementa como un adaptador que respeta la misma interfaz, así el resto del sistema (dashboard, tickets, métricas) no necesita saber de dónde vienen los datos.

```typescript
interface DeploymentProvider {
  name: Provider;
  fetchDeployments(project: Project): Promise<NormalizedDeployment[]>;
  triggerDeploy?(project: Project): Promise<void>; // no todos lo soportan
}

interface NormalizedDeployment {
  externalId: string;
  status: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'CANCELLED' | 'QUEUED';
  commitSha?: string;
  url?: string;
  logUrl?: string;
  startedAt: Date;
  finishedAt?: Date;
}
```

Un `ProviderRegistry` selecciona el adaptador correcto según `project.provider`, y un `SyncService` corre periódicamente para todos los proyectos activos.

---

## 6. Conexión con cada servicio

### 6.1 Jenkins

- **API:** REST nativa de Jenkins (`/job/{name}/lastBuild/api/json`, `/job/{name}/{number}/api/json`)
- **Auth:** usuario + API Token de Jenkins (Basic Auth)
- **Datos a extraer:** número de build, resultado (`SUCCESS`/`FAILURE`/`ABORTED`), duración, URL de consola (`/consoleText`)
- **Trigger remoto:** Jenkins soporta lanzar builds vía `POST /job/{name}/build` con token de autorización
- **Alternativa a polling:** configurar un *post-build step* en Jenkins que haga un `curl` hacia tu backend (webhook), evitando el polling constante

### 6.2 Vercel

- **API:** `https://api.vercel.com/v6/deployments`
- **Auth:** Token personal (Bearer token) generado en el dashboard de Vercel
- **Datos a extraer:** `state` (READY, ERROR, BUILDING, QUEUED), `url`, `meta.githubCommitSha`, `createdAt`, `ready` (timestamp fin)
- **Trigger remoto:** posible vía Deploy Hooks (URL única por proyecto que dispara un redeploy con un simple POST)
- **Nivel de dificultad:** bajo — buen punto de partida para el patrón adapter

### 6.3 GitHub (Actions / Pages)

- **API:** REST API de GitHub vía **Octokit** (`GET /repos/{owner}/{repo}/actions/runs`)
- **Auth:** Personal Access Token (fine-grained, con permisos de solo lectura sobre Actions) o GitHub App si se quiere algo más robusto/multi-repo
- **Datos a extraer:** `status`, `conclusion`, `head_sha`, `run_started_at`, `updated_at`, `html_url`
- **Nota:** GitHub Pages no tiene API propia de "estado de deploy" — lo que monitoreas realmente es el workflow de Actions que publica el sitio
- **Trigger remoto:** `workflow_dispatch` permite lanzar un workflow desde la API

### 6.4 AWS

AWS es el más pesado porque agrupa varios servicios distintos. Conviene elegir 1-2 para no sobre-alcanzar el proyecto:

- **AWS SDK v3 para JS:** paquetes modulares como `@aws-sdk/client-ecs`, `@aws-sdk/client-cloudformation`, `@aws-sdk/client-amplify`
- **Auth:** IAM Role con permisos mínimos (solo lectura: `ecs:DescribeServices`, `ecs:ListTasks`, `amplify:ListJobs`, etc.). En local, usar un usuario IAM con *scoped policy*, nunca la cuenta root
- **Opciones según qué quieras monitorear:**
  - **AWS Amplify:** tiene su propia API de builds (`ListJobs`), muy parecido a Jenkins/Vercel — el más fácil de integrar de todo AWS
  - **ECS:** ver estado de servicios/tasks tras un despliegue (útil si el backend corre en contenedores en AWS)
  - **CloudWatch Logs:** para traer logs asociados a un despliegue fallido
- **Decisión:** ECS — monitorear el estado de servicios/tasks tras un despliegue del backend (el backend corre en contenedores)

### 6.5 Firebase

- **Firebase Hosting:** API de administración de Hosting (`Firebase Hosting REST API`) permite listar *releases* de un sitio (`sites/{site}/releases`)
- **Auth:** Service Account (JSON de credenciales) + Firebase Admin SDK, o llamadas REST autenticadas con OAuth2 del service account
- **Datos a extraer:** `releaseTime`, `type` (DEPLOY/ROLLBACK), `version.status`
- **Cloud Functions (opcional):** si el proyecto también usa Functions, se puede complementar con Cloud Logging API (GCP) para ver logs de ejecución/errores

### 6.6 Gestión de credenciales de proveedores (API keys)

El backend expone un CRUD de credenciales por proyecto para Vercel, Jenkins, GitHub y AWS. Las claves se guardan **cifradas** en PostgreSQL y nunca se devuelven en texto plano.

- **Modelo `ProviderCredential`:** `id`, `projectId`, `provider`, `valueCiphertext`, `valueIv`, `valueTag` (AES-256-GCM), `maskedPreview` (p. ej. `vercel_••••ab12`), `createdAt`, `updatedAt`, `rotatedAt?`
- **Cifrado:** AES-256-GCM con `crypto` nativo; clave maestra en env var `CREDENTIALS_MASTER_KEY`. IV aleatorio + auth tag por valor.
- **Endpoints (solo ADMIN):**
  - `POST /projects/:id/credentials` — crear (guarda cifrado + `maskedPreview`)
  - `PUT /projects/:id/credentials/:provider` — rotar/actualizar
  - `DELETE /projects/:id/credentials/:provider` — revocar
  - `GET /projects/:id/credentials` — lista SOLO `maskedPreview` y proveedor (nunca el valor completo)
  - `POST /projects/:id/credentials/:provider/test` — prueba de conexión (llamada de solo lectura al proveedor para validar la key)
- **Consumo:** los adaptadores `DeploymentProvider` descifran la credencial solo en memoria al llamar al proveedor; nunca se loguea.
- **Rotación:** si el `test` falla, la credencial queda marcada como inválida y el ADMIN la rota con un valor nuevo.

---

## 7. Seguridad y manejo de credenciales

- Nunca almacenar tokens/API keys en la base de datos en texto plano → usar variables de entorno para el backend, o un secreto cifrado por proyecto si necesitas multi-tenant (librerías como `crypto` con AES-256 sobre el campo `providerConfig`)
- IAM con principio de mínimo privilegio para AWS
- Tokens de GitHub y Vercel con el scope más reducido posible (solo lectura donde no necesites trigger)
- Rate limiting en el backend hacia las APIs externas para no pegarte con límites de uso (especialmente GitHub API)
- HTTPS obligatorio, JWT con expiración corta + refresh tokens
- Cadena de suministro: aplicar la política de la sección 2.1 — paquetes prohibidos en toda dependencia directa o transitiva, verificado en CI (`grep` del lockfile + `npm audit`)

---

## 8. Fases de Implementación (BACKEND primero)

> El frontend NO se implementa en este plan. Se creará un documento **`plan-implementacion-frontend.md`** separado cuando el backend esté completo y testeado.

### Fase 0 — Setup base del backend (1 semana)
- TypeScript configurado en la raíz del repo, Prettier
- ESLint pineado a una versión anterior a la comprometida (validar que su árbol no incluya `flat-cache`/`file-entry-cache`/`keyv` — ver sección 2.1)
- Tests con **Node test runner** nativo (`node --test`)
- Docker Compose local con PostgreSQL + Redis
- Esquema inicial de Prisma + migraciones
- Autenticación JWT + roles (ADMIN/DEVELOPER/VIEWER)

### Fase 1 — CRUD de proyectos y usuarios (1 semana)
- Endpoints CRUD de `User` (solo admin) y `Project`
- Selección de `provider` al crear un proyecto
- Seed con datos de prueba (sin integraciones reales todavía)

### Fase 2 — Gestión de credenciales / API keys (1 semana)
- Módulo de la sección 6.6: CRUD cifrado de credenciales por proyecto (Vercel, Jenkins, GitHub, AWS)
- Endpoint de `test` de conexión por proveedor
- Tests de cifrado/descifrado y de no-filtración de secretos en las respuestas

### Fase 3 — Integración con Vercel (1 semana)
- Primer `DeploymentProvider` real (consume la credencial almacenada)
- Job de sincronización (cron simple, ej. `node-cron`) que trae deployments y los guarda en DB
- Endpoint GET de historial de deployments por proyecto

### Fase 4 — Integración con GitHub Actions (1 semana)
- Segundo adaptador, validando que el patrón `DeploymentProvider` funcione con 2 proveedores
- Ajustar el `ProviderRegistry`

### Fase 5 — Integración con Jenkins (1-2 semanas)
- Adaptador Jenkins (polling + opción de webhook)
- Endpoint para trigger de build remoto ("re-lanzar build")

### Fase 6 — Integración con AWS ECS (1-2 semanas)
- Adaptador AWS ECS (SDK v3, IAM de solo lectura)
- Estado de servicios/tasks tras un despliegue

### Fase 7 — Módulo de Tickets (1 semana)
- CRUD de tickets (backend)
- Auto-creación de ticket cuando un deployment falla

### Fase 8 — Testing completo del backend (1 semana)
- Unit tests de cada adaptador y del `SyncService`
- Integration tests (endpoints contra PostgreSQL real en CI)
- Coverage objetivo ≥ 80%
- Tests de seguridad: rate limiting, roles y no-filtración de credenciales

### Fase 9 — Dockerización y pipeline del backend (1 semana)
- Dockerfile del backend + Docker Compose completo
- `Jenkinsfile` con stages: install → audit → lint → type-check → test → build → docker build → push → deploy
- Deploy a un ambiente real (EC2, Railway, Render, o similar)

### Fase 10 — Extras opcionales (backend)
- Firebase Hosting (adaptador extra, si se decide)
- Webhooks de Jenkins/Vercel en lugar de polling
- Auditoría de acciones (`AuditLog`)

### Fase 11 — Proyecto frontend (SEPARADO — no se implementa en este repo)
- Cuando el backend esté completo y testeado, crear el proyecto frontend React + Vite en un repositorio aparte, con su propio plan
- Ese plan cubrirá: React + Vite + TypeScript, TanStack Query, Recharts, Tailwind, login, CRUD de proyectos, gestión visual de API keys, dashboard con métricas, vista de deployments y tickets
- El frontend consumirá solo los endpoints del backend ya definidos aquí

---

## 9. Ejemplo de `Jenkinsfile` (pipeline del propio proyecto — backend)

```groovy
pipeline {
  agent any
  stages {
    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }
    stage('Dependency Audit') {
      steps {
        sh 'npm audit --audit-level=high && node scripts/check-banned-deps.mjs'
      }
    }
    stage('Lint & Type Check') {
      steps {
        sh 'npm run lint && npx tsc --noEmit'
      }
    }
    stage('Test') {
      steps {
        sh 'node --test'
      }
    }
    stage('Build') {
      steps {
        sh 'npm run build'
      }
    }
    stage('Docker Build') {
      steps {
        sh 'docker build -t devops-dashboard-backend .'
      }
    }
    stage('Push & Deploy') {
      steps {
        echo 'Push a registry y deploy al ambiente destino'
      }
    }
  }
}
```

---

## 10. Orden de prioridad recomendado

Si el tiempo es limitado, este es el orden que da más valor de portfolio con menos esfuerzo:

1. Fases 0, 1, 2 (base + CRUD + gestión de API keys) — la gestión segura de credenciales es el diferenciador
2. Fase 3 (Vercel) — demuestra el patrón adapter con datos reales
3. Fase 4 (GitHub Actions) — valida que el patrón escala a un segundo proveedor
4. Fase 8 (testing completo) — condición necesaria para pasar al frontend
5. Fases 5, 6, 7 (Jenkins, ECS, tickets) — según tiempo disponible
6. Fase 11 (frontend) — SOLO cuando el backend esté completo y testeado

---
