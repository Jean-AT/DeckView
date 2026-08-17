import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { decryptSecret, encryptSecret, maskSecret } from '../utils/cipher';
import { testCredential } from '../services/credentialTest';
import { audit } from '../services/audit';

// ============================================================================
// Schemas de validación (Zod)
// ============================================================================
const PROVIDER_ENUM = z.enum(['JENKINS', 'VERCEL', 'GITHUB_ACTIONS', 'AWS', 'FIREBASE']);

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

const providerParamsSchema = projectParamsSchema.extend({
  provider: PROVIDER_ENUM,
});

const createSchema = z.object({
  provider: PROVIDER_ENUM,
  value: z.string().min(1).max(500),
});

const rotateSchema = z.object({
  value: z.string().min(1).max(500),
});

const PUBLIC_SELECT = {
  id: true,
  provider: true,
  maskedPreview: true,
  isValid: true,
  createdAt: true,
  updatedAt: true,
  rotatedAt: true,
} as const;

export const credentialsRouter = Router({ mergeParams: true });

// Las credenciales son gestión sensible: solo ADMIN.
credentialsRouter.use(requireAuth, requireRole('ADMIN'));

async function projectExists(projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  return project !== null;
}

// GET /projects/:projectId/credentials → listar (solo maskedPreview, nunca el valor)
credentialsRouter.get('/', async (req, res) => {
  const params = projectParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }

  if (!(await projectExists(params.data.projectId))) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const data = await prisma.providerCredential.findMany({
    where: { projectId: params.data.projectId },
    select: PUBLIC_SELECT,
    orderBy: { createdAt: 'asc' },
  });

  res.json({ data });
});

// POST /projects/:projectId/credentials → crear (cifrado + maskedPreview)
credentialsRouter.post('/', async (req, res) => {
  const params = projectParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid project id' });
    return;
  }
  const { projectId } = params.data;

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  if (!(await projectExists(projectId))) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const existing = await prisma.providerCredential.findUnique({
    where: { projectId_provider: { projectId, provider: parsed.data.provider } },
  });
  if (existing) {
    res.status(409).json({ error: 'Credential already exists for this provider' });
    return;
  }

  const encrypted = encryptSecret(parsed.data.value);

  const credential = await prisma.providerCredential.create({
    data: {
      projectId,
      provider: parsed.data.provider,
      valueCiphertext: encrypted.ciphertext,
      valueIv: encrypted.iv,
      valueTag: encrypted.tag,
      maskedPreview: maskSecret(parsed.data.value),
      isValid: testCredential(parsed.data.provider, parsed.data.value).ok,
    },
    select: PUBLIC_SELECT,
  });

  await audit.log({
    userId: req.user!.id,
    action: 'credential.create',
    resourceType: 'CREDENTIAL',
    resourceId: credential.id,
    details: { projectId, provider: parsed.data.provider },
  });

  res.status(201).json(credential);
});

// PUT /projects/:projectId/credentials/:provider → rotar/actualizar
credentialsRouter.put('/:provider', async (req, res) => {
  const params = providerParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid project id or provider' });
    return;
  }
  const { projectId, provider } = params.data;

  const parsed = rotateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    return;
  }

  const existing = await prisma.providerCredential.findUnique({
    where: { projectId_provider: { projectId, provider } },
  });
  if (!existing) {
    if (!(await projectExists(projectId))) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.status(404).json({ error: 'Credential not found' });
    return;
  }

  const encrypted = encryptSecret(parsed.data.value);

  const updated = await prisma.providerCredential.update({
    where: { id: existing.id },
    data: {
      valueCiphertext: encrypted.ciphertext,
      valueIv: encrypted.iv,
      valueTag: encrypted.tag,
      maskedPreview: maskSecret(parsed.data.value),
      isValid: testCredential(provider, parsed.data.value).ok,
      rotatedAt: new Date(),
    },
    select: PUBLIC_SELECT,
  });

  await audit.log({
    userId: req.user!.id,
    action: 'credential.rotate',
    resourceType: 'CREDENTIAL',
    resourceId: existing.id,
    details: { projectId, provider },
  });

  res.json(updated);
});

// POST /projects/:projectId/credentials/:provider/test → prueba de conexión
credentialsRouter.post('/:provider/test', async (req, res) => {
  const params = providerParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid project id or provider' });
    return;
  }
  const { projectId, provider } = params.data;

  const existing = await prisma.providerCredential.findUnique({
    where: { projectId_provider: { projectId, provider } },
  });
  if (!existing) {
    if (!(await projectExists(projectId))) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.status(404).json({ error: 'Credential not found' });
    return;
  }

  const plaintext = decryptSecret({
    ciphertext: existing.valueCiphertext,
    iv: existing.valueIv,
    tag: existing.valueTag,
  });

  const result = testCredential(provider, plaintext);

  await prisma.providerCredential.update({
    where: { id: existing.id },
    data: { isValid: result.ok },
  });

  res.json(result);
});

// DELETE /projects/:projectId/credentials/:provider → revocar
credentialsRouter.delete('/:provider', async (req, res) => {
  const params = providerParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: 'Invalid project id or provider' });
    return;
  }
  const { projectId, provider } = params.data;

  const existing = await prisma.providerCredential.findUnique({
    where: { projectId_provider: { projectId, provider } },
  });
  if (!existing) {
    if (!(await projectExists(projectId))) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.status(404).json({ error: 'Credential not found' });
    return;
  }

  await prisma.providerCredential.delete({ where: { id: existing.id } });

  await audit.log({
    userId: req.user!.id,
    action: 'credential.delete',
    resourceType: 'CREDENTIAL',
    resourceId: existing.id,
    details: { projectId, provider },
  });

  res.status(204).end();
});
