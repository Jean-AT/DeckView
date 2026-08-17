import type { NormalizedDeployment } from '../providers';
import type { Prisma, Provider } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface PersistedDeployment {
  id: string;
  created: boolean;
}

export async function upsertDeployment(
  projectId: string,
  provider: Provider,
  projectName: string,
  deployment: NormalizedDeployment,
): Promise<PersistedDeployment> {
  const finishedAt = deployment.finishedAt ?? null;
  const rawDuration =
    deployment.finishedAt && deployment.finishedAt >= deployment.startedAt
      ? deployment.finishedAt.getTime() - deployment.startedAt.getTime()
      : null;
  // durationMs es INT4 (2^31-1); clamps para que payloads maliciosos no rompan la consulta.
  const durationMs =
    rawDuration !== null && rawDuration <= 2_147_483_647 ? rawDuration : null;

  const row = await prisma.deployment.upsert({
    where: { projectId_externalId: { projectId, externalId: deployment.externalId } },
    update: {
      status: deployment.status,
      commitSha: deployment.commitSha ?? null,
      url: deployment.url ?? null,
      logUrl: deployment.logUrl ?? null,
      durationMs,
      startedAt: deployment.startedAt,
      finishedAt,
      metadata: deployment.metadata as Prisma.InputJsonValue | undefined,
    },
    create: {
      projectId,
      provider,
      externalId: deployment.externalId,
      status: deployment.status,
      commitSha: deployment.commitSha ?? null,
      url: deployment.url ?? null,
      logUrl: deployment.logUrl ?? null,
      durationMs,
      startedAt: deployment.startedAt,
      finishedAt,
      metadata: deployment.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  let created = false;
  if (deployment.status === 'FAILED') {
    const ticket = await ensureTicketForFailedDeployment({
      deploymentId: row.id,
      projectId,
      projectName,
      externalId: deployment.externalId,
      url: deployment.url,
    });
    created = ticket.created;
  }

  return { id: row.id, created };
}

async function ensureTicketForFailedDeployment(args: {
  deploymentId: string;
  projectId: string;
  projectName: string;
  externalId: string;
  url?: string;
}): Promise<{ created: boolean }> {
  const { deploymentId, projectId, projectName, externalId, url } = args;

  const existing = await prisma.ticket.findFirst({ where: { deploymentId } });
  if (existing) return { created: false };

  await prisma.ticket.create({
    data: {
      projectId,
      deploymentId,
      title: `Deploy fallido: ${projectName} (${externalId})`,
      description: url
        ? `Se creó automáticamente al detectar el fallo del deployment ${externalId}. Ver: ${url}`
        : `Se creó automáticamente al detectar el fallo del deployment ${externalId}.`,
      priority: 'HIGH',
      status: 'OPEN',
    },
  });

  return { created: true };
}