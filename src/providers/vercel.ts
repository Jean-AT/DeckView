import type { Project } from '@prisma/client';
import type { DeploymentProvider, NormalizedDeployment } from './types';
import { AuthError, ProviderError } from './types';

const VERCEL_API = 'https://api.vercel.com/v6/deployments';

interface VercelDeployment {
  uid: string;
  url?: string;
  state: string;
  createdAt: number;
  ready?: number | null;
  meta?: Record<string, string>;
}

function mapStatus(state: string): NormalizedDeployment['status'] {
  switch (state) {
    case 'READY':
      return 'SUCCESS';
    case 'ERROR':
      return 'FAILED';
    case 'CANCELED':
      return 'CANCELLED';
    case 'QUEUED':
      return 'QUEUED';
    default:
      // BUILDING, INITIALIZING, ... → en curso
      return 'RUNNING';
  }
}

function mapDeployment(deployment: VercelDeployment): NormalizedDeployment {
  const commitSha =
    deployment.meta?.githubCommitSha ?? deployment.meta?.commitSha ?? undefined;

  return {
    externalId: deployment.uid,
    status: mapStatus(deployment.state),
    commitSha,
    url: deployment.url ? `https://${deployment.url}` : undefined,
    startedAt: new Date(deployment.createdAt),
    finishedAt: deployment.ready ? new Date(deployment.ready) : undefined,
  };
}

export class VercelProvider implements DeploymentProvider {
  name = 'VERCEL' as const;

  async fetchDeployments(project: Project, secret: string): Promise<NormalizedDeployment[]> {
    const config = (project.providerConfig ?? {}) as { vercelProjectId?: unknown };

    const url = new URL(VERCEL_API);
    if (typeof config.vercelProjectId === 'string' && config.vercelProjectId) {
      url.searchParams.set('projectId', config.vercelProjectId);
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`Vercel rejected the token (HTTP ${res.status})`);
      }
      throw new ProviderError(`Vercel API error (HTTP ${res.status})`);
    }

    const body = (await res.json()) as { deployments?: VercelDeployment[] };
    return (body.deployments ?? []).map(mapDeployment);
  }
}
