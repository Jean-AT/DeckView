import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

// ============================================================================
// Schemas de validación (Zod)
// ============================================================================
const PRIORITY_ENUM = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const TICKET_STATUS_ENUM = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);

const ticketCreateSchema = z.object({
  projectId: z.string().uuid(),
  deploymentId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priority: PRIORITY_ENUM.optional(),
  assignedTo: z.string().max(100).optional(),
});

const ticketUpdateSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000),
    priority: PRIORITY_ENUM,
    status: TICKET_STATUS_ENUM,
    assignedTo: z.string().max(100).nullable(),
  })
  .partial();

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const listQuerySchema = z.object({
  status: TICKET_STATUS_ENUM.optional(),
  priority: PRIORITY_ENUM.optional(),
  projectId: z.string().uuid().optional(),
  assignedTo: z.string().max(100).optional(),
});

const TICKET_SELECT = {
  id: true,
  projectId: true,
  deploymentId: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  assignedTo: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
} as const;

export const ticketsRouter = Router();

ticketsRouter.use(requireAuth);

// GET /api/tickets → listar (paginado + filtros por status/priority/proyecto/asignado)
ticketsRouter.get('/', async (req, res) => {
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: 'Invalid query', details: query.error.flatten().fieldErrors });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const where = {
    ...(query.data.status ? { status: query.data.status } : {}),
    ...(query.data.priority ? { priority: query.data.priority } : {}),
    ...(query.data.projectId ? { projectId: query.data.projectId } : {}),
    ...(query.data.assignedTo ? { assignedTo: query.data.assignedTo } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      select: TICKET_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.ticket.count({ where }),
  ]);

  res.json({ data, total, limit, offset });
});

// GET /api/tickets/:id → detalle
ticketsRouter.get('/:id', async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: params.data.id },
    select: TICKET_SELECT,
  });

  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  res.json(ticket);
});

// POST /api/tickets → crear (solo ADMIN/DEVELOPER)
ticketsRouter.post('/', requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const parsed = ticketCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId },
    select: { id: true },
  });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const ticket = await prisma.ticket.create({
    data: {
      projectId: parsed.data.projectId,
      deploymentId: parsed.data.deploymentId,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority ?? 'MEDIUM',
      assignedTo: parsed.data.assignedTo,
    },
    select: TICKET_SELECT,
  });

  res.status(201).json(ticket);
});

// PATCH /api/tickets/:id → actualizar (solo ADMIN/DEVELOPER)
ticketsRouter.patch('/:id', requireRole('ADMIN', 'DEVELOPER'), async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const parsed = ticketUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  const existing = await prisma.ticket.findUnique({ where: { id: params.data.id } });
  if (!existing) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  const updated = await prisma.ticket.update({
    where: { id: params.data.id },
    data: parsed.data,
    select: TICKET_SELECT,
  });

  res.json(updated);
});

// DELETE /api/tickets/:id → eliminar (solo ADMIN)
ticketsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const existing = await prisma.ticket.findUnique({ where: { id: params.data.id } });
  if (!existing) {
    res.status(404).json({ error: 'Ticket not found' });
    return;
  }

  await prisma.ticket.delete({ where: { id: params.data.id } });

  res.status(204).end();
});
