import type { NormalizedDeployment } from '../providers';
import { AuthError, ProviderError, providerRegistry } from '../providers';
import type { Provider } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decryptSecret } from '../utils/cipher';

export type SyncStatus = 'ok' | 'skipped' | 'auth_error' | 'error';

export interface SyncResult {
  status: SyncStatus;
  count?: number;
  error?: string;
}

export class SyncService {
  async syncProject(projectId: string): Promise<SyncResult> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { credentials: true },
    });

    if (!project) {
      return { status: 'error', error: 'Project not found' };
    }

    const credential = project.credentials.find(
      (cred) => cred.provider === project.provider,
    );

    if (!credential) {
      return { status: 'skipped', error: `No credential stored for ${project.provider}` };
    }

    let provider: ReturnType<typeof providerRegistry.get>;
    try {
      provider = providerRegistry.get(project.provider);
    } catch (err) {
      if (err instanceof ProviderError) {
        return { status: 'error', error: err.message };
      }
      throw err;
    }

    // El secreto se descifra solo en memoria; nunca se loguea.
    const secret = decryptSecret({
      ciphertext: credential.valueCiphertext,
      iv: credential.valueIv,
      tag: credential.valueTag,
    });

    try {
      const deployments = await provider.fetchDeployments(project, secret);
      await this.upsertDeployments(project.id, project.provider, deployments);
      return { status: 'ok', count: deployments.length };
    } catch (err) {
      if (err instanceof AuthError) {
        await prisma.providerCredential.update({
          where: { id: credential.id },
          data: { isValid: false },
        });
        return { status: 'auth_error', error: err.message };
      }
      if (err instanceof ProviderError) {
        return { status: 'error', error: err.message };
      }
      throw err;
    }
  }

  async syncAll(): Promise<SyncResult[]> {
    const projects = await prisma.project.findMany({ select: { id: true } });
    const results: SyncResult[] = [];

    for (const project of projects) {
      results.push(await this.syncProject(project.id));
    }

    return results;
  }

  private async upsertDeployments(
    projectId: string,
    provider: Provider,
    deployments: NormalizedDeployment[],
  ): Promise<void> {
    for (const deployment of deployments) {
      const finishedAt = deployment.finishedAt ?? null;
      const durationMs =
        deployment.finishedAt && deployment.finishedAt >= deployment.startedAt
          ? deployment.finishedAt.getTime() - deployment.startedAt.getTime()
          : null;

      await prisma.deployment.upsert({
        where: { projectId_externalId: { projectId, externalId: deployment.externalId } },
        update: {
          status: deployment.status,
          commitSha: deployment.commitSha ?? null,
          url: deployment.url ?? null,
          logUrl: deployment.logUrl ?? null,
          durationMs,
          startedAt: deployment.startedAt,
          finishedAt,
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
        },
      });
    }
  }
}

export const syncService = new SyncService();
