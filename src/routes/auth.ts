import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashPassword, verifyPassword } from '../utils/password';
import { signToken, verifyToken } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { audit } from '../services/audit';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

async function issueTokens(user: { id: string; role: string }) {
  return {
    accessToken: signToken({ sub: user.id, role: user.role, kind: 'access' }),
    refreshToken: signToken({ sub: user.id, role: user.role, kind: 'refresh' }),
  };
}

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { name, email, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const userCount = await prisma.user.count();
  const role = userCount === 0 ? 'ADMIN' : 'VIEWER';

  const user = await prisma.user.create({
    data: { name, email, password: await hashPassword(password), role },
  });

  await audit.log({
    userId: user.id,
    action: 'auth.register',
    resourceType: 'USER',
    resourceId: user.id,
    details: { email },
  });

  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    ...(await issueTokens(user)),
  });
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await verifyPassword(password, user.password))) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  await audit.log({
    userId: user.id,
    action: 'auth.login',
    resourceType: 'USER',
    resourceId: user.id,
  });

  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    ...(await issueTokens(user)),
  });
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }

    const { sub } = verifyRefreshToken(parsed.data.refreshToken);

    const user = await prisma.user.findUnique({ where: { id: sub } });

    if (!user) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    res.json(await issueTokens(user));
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

function verifyRefreshToken(token: string) {
  return verifyToken(token, 'refresh');
}
