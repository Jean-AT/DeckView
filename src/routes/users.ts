import { Router } from 'express';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { hashPassword } from '../utils/password';

const ROLE_ENUM = z.enum(['ADMIN', 'DEVELOPER', 'VIEWER']);

const userCreateSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  role: ROLE_ENUM,
});

const userUpdateSchema = z
  .object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    role: ROLE_ENUM,
  })
  .partial();

const passwordSchema = z.object({
  password: z.string().min(8).max(72),
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} as const;

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole('ADMIN'));

usersRouter.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
      skip: offset,
      take: limit,
    }),
    prisma.user.count(),
  ]);

  res.json({ data, total, limit, offset });
});

usersRouter.get('/:id', async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: params.data.id },
    select: SAFE_SELECT,
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
});

usersRouter.post('/', async (req, res) => {
  const parsed = userCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { name, email, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const user = await prisma.user.create({
    data: { name, email, password: await hashPassword(password), role },
    select: SAFE_SELECT,
  });

  res.status(201).json(user);
});

  usersRouter.patch('/:id/password', async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { id: params.data.id } });
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  await prisma.user.update({
    where: { id: params.data.id },
    data: { password: await hashPassword(parsed.data.password) },
  });

  res.json({ ok: true });
});

// PATCH /api/users/:id → actualizar name / email / role
usersRouter.patch('/:id', async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const { id } = params.data;

  const parsed = userUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  // Un admin no puede cambiar su propio rol (evita auto-rebajarse).
  if (id === req.user!.id && parsed.data.role !== undefined) {
    res.status(400).json({ error: 'You cannot change your own role' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (parsed.data.email !== undefined) {
    const duplicate = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (duplicate && duplicate.id !== id) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
  }

  const data: { name?: string; email?: string; role?: Role } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.email !== undefined) data.email = parsed.data.email;
  if (parsed.data.role !== undefined) data.role = parsed.data.role;

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: SAFE_SELECT,
  });

  res.json(updated);
});

// DELETE /api/users/:id → eliminar
usersRouter.delete('/:id', async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const { id } = params.data;

  if (id === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  await prisma.user.delete({ where: { id } });

  res.status(204).end();
});
