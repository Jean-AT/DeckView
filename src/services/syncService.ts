import { AuthError, ProviderError, providerRegistry } from '../providers';
import { prisma } from '../lib/prisma';
import { decryptSecret } from '../utils/cipher';
import { createRateLimiter, type RateLimiter } from '../utils/rateLimiter';
import { env } from '../config/env';
import { upsertDeployment } from './deployments';

export type SyncStatus = 'ok' | 'skipped' | 'auth_error' | 'rate_limited' | 'error';

export interface SyncResult {
  status: SyncStatus;
  count?: number;
  error?: string;
}

export type TriggerStatus = SyncStatus | 'unsupported';

export interface TriggerResult {
  status: TriggerStatus;
  error?: string;
}

export class SyncService {
  // Limiter saliente hacia las APIs externas (inyectable en tests).
  constructor(
    private readonly limiter: RateLimiter = createRateLimiter(
      env.OUTBOUND_RATE_LIMIT_PER_MINUTE,
      60_000,
    ),
  ) {}

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

    if (!this.limiter.allow(project.provider)) {
      return { status: 'rate_limited', error: 'Outbound rate limit exceeded' };
    }

    try {
      const deployments = await provider.fetchDeployments(project, secret);
      for (const deployment of deployments) {
        await upsertDeployment(project.id, project.provider, project.name, deployment);
      }
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

  async triggerDeploy(projectId: string): Promise<TriggerResult> {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { credentials: true },
    });

    if (!project) {
      return { status: 'error', error: 'Project not found' };
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

    if (!provider.triggerDeploy) {
      return {
        status: 'unsupported',
        error: `${provider.name} does not support remote deploy triggers`,
      };
    }

    const credential = project.credentials.find(
      (cred) => cred.provider === project.provider,
    );

    if (!credential) {
      return { status: 'skipped', error: `No credential stored for ${project.provider}` };
    }

    // El secreto se descifra solo en memoria; nunca se loguea.
    const secret = decryptSecret({
      ciphertext: credential.valueCiphertext,
      iv: credential.valueIv,
      tag: credential.valueTag,
    });

    if (!this.limiter.allow(project.provider)) {
      return { status: 'rate_limited', error: 'Outbound rate limit exceeded' };
    }

    try {
      await provider.triggerDeploy(project, secret);
      return { status: 'ok' };
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
}

export const syncService = new SyncService();
