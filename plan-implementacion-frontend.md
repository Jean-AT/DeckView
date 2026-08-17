# Plan de Implementación: Frontend DeckView (estilo crafter.run)

> **Contexto:** este documento complementa `plan-implementacion-devops-dashboard.md`. El backend
> (API REST + jobs de sincronización + credenciales cifradas + tickets) está completo y testeado.
> El frontend vive en un **repositorio separado**: `DeckViewWebApp`
> (https://github.com/Jean-AT/DeckViewWebApp.git), implementado directamente sobre `main`
> (sin gitflow: cada fase se commitea en main).

---

## 1. Referencia de diseño: crafter.run

El sistema de diseño se extrajo del sitio **https://crafter.run/en** (fuentes, tokens de color HSL,
patrones de layout y componentes tomados de su CSS real).

### 1.1 Tipografía

| Uso | Fuente | Notas |
|---|---|---|
| UI / títulos | **Space Grotesk** (300–700) | `--font-display`; títulos `tracking-tight` |
| Datos / código / métricas | **JetBrains Mono** | eyebrows, números display, hashes, timestamps |

- **Eyebrow de sección:** `font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground`
  (ej. `01 / PROJECTS`).
- **Títulos:** `text-3xl md:text-4xl tracking-tight`.
- **Números display (stats):** `font-mono` grande, peso light.
- Fuentes servidas con `@fontsource/space-grotesk` y `@fontsource/jetbrains-mono`.

### 1.2 Tokens de color (shadcn-style, dark-first)

| Token | Dark (por defecto) | Light |
|---|---|---|
| `--background` | `0 0% 5%` | `0 0% 100%` |
| `--foreground` | `0 0% 96%` | `0 0% 8%` |
| `--card` | `0 0% 5%` | `0 0% 100%` |
| `--primary` / `--primary-foreground` | `0 0% 96%` / `5%` | `0 0% 8%` / `98%` |
| `--secondary` / `--muted` | `0 0% 12%` | `0 0% 96%` |
| `--muted-foreground` | `0 0% 60%` | `0 0% 42%` |
| `--accent-surface` | `40 30% 92%` (crema) | `40 26% 29%` (oliva cálido) |
| `--border` / `--line` | `0 0% 16%` | `0 0% 90%` |
| `--destructive` | `0 62.8% 30.6%` | igual |
| `--radius` | `.5rem` | igual |

- Dark por defecto + toggle manual (persistido en `localStorage`). En light, `--accent-surface`
  invierte (fondo crema en dark, texto oliva en light) igual que crafter.run.
- **Colores de estado DevOps** (extensión coherente): `SUCCESS` → `#00c758`,
  `FAILED` → `#fb2c36`, `RUNNING` → ámbar con pulso, `QUEUED`/`CANCELLED` → muted.

### 1.3 Layout y componentes

- Contenedor `max-w-[1380px]`; separadores hairline de 1px (`--line`) por toda la UI.
- Botón primario **invertido**: `bg-foreground text-background`; links con `arrow-up-right`
  que rota 45° en hover.
- Badges/pills: `rounded-full border px-2.5 py-0.5 text-xs font-semibold`.
- Cards: `border border-line`, **brackets** en las esquinas (`border-t border-l border-line`),
  hover `bg-accent-surface/10`.
- Stats: número mono grande + label muted; watermark `text-foreground/20`.
- Nav superior con tabs + toggle de tema + menú de usuario.

---

## 2. Stack y arquitectura

| Capa | Tecnología |
|---|---|
| Build | Vite + React + TypeScript |
| Estilos | Tailwind CSS 4 + tokens propios (`@theme inline` con vars CSS) |
| Server state | TanStack Query v5 |
| Routing | React Router |
| Forms | react-hook-form + zod |
| Gráficas | Recharts |
| Iconos | lucide-react |
| HTTP | `fetch` nativo (tipado) |

- **Carpeta/repo:** `DeckViewWebApp`, rama `main` (sin gitflow).
- **Proxy dev:** Vite `/api` → `http://localhost:3000` (el backend no expone CORS; se evita en dev).
- **Prod:** servir el SPA desde el mismo origen (Nginx/reverse proxy) o añadir `cors` al backend.
- **Supply-chain:** lockfile commiteado + `npm audit` en CI. Evitar paquetes prohibidos
  (sección 2.1 del plan backend).

### 2.1 Estructura

```
src/
  main.tsx / App.tsx / index.css
  lib/        api.ts · auth.ts · cn.ts · format.ts
  types/      api.ts            (tipos espejo del backend)
  queries/    keys.ts · projects.ts · deployments.ts · tickets.ts · users.ts · credentials.ts
  components/
    ui/       Badge · Button · Card · Stat · SectionHeader · StatusDot · Input · Select · Textarea · Modal · Spinner · EmptyState · Toast
    layout/   AppShell · TopNav · UserMenu · ThemeToggle
  features/
    auth/     LoginPage · RegisterPage
    dashboard/ DashboardPage
    projects/ ProjectsPage · ProjectDetailPage · ProjectFormModal · DeploymentsTable · CredentialsSection
    tickets/  TicketsPage · TicketDetailPage · TicketFormModal
    users/    UsersPage
```

### 2.2 Data layer

- `lib/api.ts` — wrapper `fetch` tipado; adjunta `Authorization: Bearer <accessToken>`.
- `lib/auth.ts` — accessToken en memoria + refreshToken en `localStorage`; refresh
  single-flight ante 401 y redirect a `/login`.
- Roles: `ADMIN` / `DEVELOPER` / `VIEWER` — la UI oculta acciones según el rol devuelto por
  `GET /auth/me` (misma lógica que `requireRole` del backend).

---

## 3. Sitemap

| Ruta | Página | Notas |
|---|---|---|
| `/login`, `/register` | Auth | Card centrada; register = `POST /auth/register` (primer usuario → ADMIN) |
| `/` (shell) | Dashboard | Stats (proyectos, deploys, % éxito, tickets abiertos), grid de proyectos, últimos deploys, chart Recharts "deploys por día" + donut éxito/fallo |
| `/projects` | Proyectos | Grid de cards con badge de proveedor + último estado |
| `/projects/:id` | Detalle | Header + badges; botones **Sync** (ADMIN) y **Trigger** (ADMIN/DEV) con estados de `SyncResult`; timeline de deploys; credentials (ADMIN); tickets del proyecto |
| `/tickets` | Tickets | Filtros chips (status/priority/project/assignedTo), lista + detalle |
| `/users` | Usuarios (ADMIN) | Tabla con badges de rol, CRUD |

Todos los endpoints consumidos están verificados contra `src/routes/*` del backend.

---

## 4. Fases (implementadas sobre `main`)

- **F0 — Scaffold + design system:** repo Vite, tokens CSS, fuentes, toggle dark/light,
  componentes base, AppShell + routing skeleton.
- **F1 — Auth:** login/register, gestión de tokens, refresh, rutas protegidas, UserMenu.
- **F2 — Dashboard:** API client + TanStack Query, stats, charts Recharts, últimos deploys.
- **F3 — Proyectos:** listado, crear/editar, detalle (timeline deploys, sync, trigger con confirmación).
- **F4 — Credenciales (ADMIN):** add key, masked preview, test de conexión, rotar, revocar.
- **F5 — Tickets:** lista con filtros, detalle, crear, transición de estado.
- **F6 — Usuarios (ADMIN):** CRUD + badges de rol.
- **F7 — Pulido:** empty states, skeletons, toasts, responsivo, QA dark/light, accesibilidad.
- **F8 — Calidad:** Vitest + RTL (core), lint/typecheck, build, Dockerfile + Jenkinsfile.

---

## 5. Pre-requisitos

- Backend corriendo en `http://localhost:3000` (ver `docker-compose.yml` y `.env` del repo backend).
- `.env.local` del frontend: `VITE_API_URL=/api` (usa el proxy de Vite en dev).