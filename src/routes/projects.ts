import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, Provider } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { syncService } from '../services/syncService';

// ============================================================================
// Schemas de validación (Zod)
// ============================================================================
const PROVIDER_ENUM = z.enum(['JENKINS', 'VERCEL', 'GITHUB_ACTIONS', 'AWS', 'FIREBASE']);

const projectCreateSchema = z.object({
  name: z.string().min(1).max(100),
  repoUrl: z.string().url().optional(),
  provider: PROVIDER_ENUM,
  providerConfig: z.custom<Prisma.InputJsonValue>().optional(),
});

// Todos los campos opcionales (típico de PATCH).
const projectUpdateSchema = projectCreateSchema.partial();

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const SAFE_SELECT = {
  id: true,
  name: true,
  repoUrl: true,
  provider: true,
  providerConfig: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const projectsRouter = Router();

// Cualquier usuario autenticado puede leer; solo ADMIN/DEVELOPER escriben.
projectsRouter.use(requireAuth);

// GET /api/projects → listar (paginado)
projectsRouter.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const [data, total] = await Promise.all([
    prisma.project.findMany({
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
      skip: offset,
      take: limit,
    }),
    prisma.project.count(),
  ]);

  res.json({ data, total, limit, offset });
});

// GET /api/projects/:id → detalle
projectsRouter.get('/:id', async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const project = await prisma.project.findUnique({
    where: { id: params.data.id },
    select: SAFE_SELECT,
  });

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json(project);
});

// GET /api/projects/:id/deployments → historial de deployments (paginado)
projectsRouter.get('/:id/deployments', async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const { id } = params.data;

  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const [data, total] = await Promise.all([
    prisma.deployment.findMany({
      where: { projectId: id },
      orderBy: { startedAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.deployment.count({ where: { projectId: id } }),
  ]);

  res.json({ data, total, limit, offset });
});

// POST /api/projects/:id/sync → sincronizar con el proveedor (solo ADMIN)
projectsRouter.post('/:id/sync', requireRole('ADMIN'), async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const { id } = params.data;

  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const result = await syncService.syncProject(id);

  const statusCode =
    result.status === 'ok'
      ? 200
      : result.status === 'auth_error'
        ? 401
        : result.status === 'skipped'
          ? 409
          : 500;

  res.status(statusCode).json(result);
});

// POST /api/projects → crear (solo ADMIN/DEVELOPER)
projectsRouter.post('/', requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const parsed = projectCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { name, repoUrl, provider, providerConfig } = parsed.data;

  const existing = await prisma.project.findFirst({ where: { name } });
  if (existing) {
    res.status(409).json({ error: 'Project name already exists' });
    return;
  }

  const project = await prisma.project.create({
    data: { name, repoUrl, provider, providerConfig: providerConfig ?? {} },
    select: SAFE_SELECT,
  });

  res.status(201).json(project);
});

// PATCH /api/projects/:id → actualizar (solo ADMIN/DEVELOPER)
projectsRouter.patch('/:id', requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const { id } = params.data;

  const parsed = projectUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (parsed.data.name !== undefined) {
    const duplicate = await prisma.project.findFirst({ where: { name: parsed.data.name } });
    if (duplicate && duplicate.id !== id) {
      res.status(409).json({ error: 'Project name already exists' });
      return;
    }
  }

  const data: {
    name?: string;
    repoUrl?: string;
    provider?: Provider;
    providerConfig?: Prisma.InputJsonValue;
  } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.repoUrl !== undefined) data.repoUrl = parsed.data.repoUrl;
  if (parsed.data.provider !== undefined) data.provider = parsed.data.provider;
  if (parsed.data.providerConfig !== undefined) data.providerConfig = parsed.data.providerConfig;

  const updated = await prisma.project.update({
    where: { id },
    data,
    select: SAFE_SELECT,
  });

  res.json(updated);
});

// DELETE /api/projects/:id → eliminar (solo ADMIN/DEVELOPER)
projectsRouter.delete('/:id', requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const { id } = params.data;

  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  await prisma.project.delete({ where: { id } });

  res.status(204).end();
});
