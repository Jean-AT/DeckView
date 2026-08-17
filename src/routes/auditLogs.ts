import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const auditLogsRouter = Router();

const filterSchema = z.object({
  action: z.string().min(1).max(100).optional(),
  resourceType: z.string().min(1).max(100).optional(),
  userId: z.string().uuid().optional(),
});

// Solo ADMIN puede consultar la auditoría de acciones.
auditLogsRouter.use(requireAuth, requireRole('ADMIN'));

// GET /api/audit-logs → listar eventos (paginado y filtrable)
auditLogsRouter.get('/', async (req, res) => {
  const filters = filterSchema.safeParse({
    action: req.query.action,
    resourceType: req.query.resourceType,
    userId: req.query.userId,
  });

  if (!filters.success) {
    res.status(400).json({ error: 'Invalid filters' });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const where = {
    ...(filters.data.action ? { action: filters.data.action } : {}),
    ...(filters.data.resourceType ? { resourceType: filters.data.resourceType } : {}),
    ...(filters.data.userId ? { userId: filters.data.userId } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ data, total, limit, offset });
});