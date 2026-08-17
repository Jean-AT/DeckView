import type { Provider } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { upsertDeployment } from './deployments';
import type { NormalizedDeployment } from '../providers';

export type WebhookProvider = 'VERCEL' | 'JENKINS';

export interface WebhookIngestResult {
  status: 'ok' | 'project_not_found';
  deploymentId?: string;
  error?: string;
}

interface VercelWebhookPayload {
  type?: string;
  payload?: Record<string, unknown>;
}

interface JenkinsWebhookPayload {
  project?: { name?: string };
  name?: string;
  build?: {
    number?: number;
    url?: string;
    status?: string;
    timestamp?: number;
    scm?: { commit?: string; branch?: string };
  };
}

export class WebhookService {
  async ingest(provider: WebhookProvider, payload: unknown): Promise<WebhookIngestResult> {
    const deployments =
      provider === 'VERCEL' ? this.normalizeVercel(payload) : this.normalizeJenkins(payload);

    if (deployments.length === 0) {
      return { status: 'project_not_found', error: 'No deployment identified in payload' };
    }

    const project = await this.findProjectForWebhook(provider, payload);
    if (!project) {
      return { status: 'project_not_found', error: 'No project matches this webhook' };
    }

    let lastId: string | undefined;
    for (const deployment of deployments) {
      const persisted = await upsertDeployment(project.id, project.provider, project.name, deployment);
      lastId = persisted.id;
    }

    return { status: 'ok', deploymentId: lastId };
  }

  private normalizeVercel(payload: unknown): NormalizedDeployment[] {
    const root = (payload ?? {}) as VercelWebhookPayload;
    const deployment = (root.payload ?? root) as Record<string, unknown>;

    const externalId = deployment.uid ?? deployment.id;
    if (typeof externalId !== 'string') return [];

    const readyState = deployment.readyState ?? deployment.state;

    return [
      {
        externalId,
        status: mapVercelStatus(String(readyState)),
        commitSha: getMetaValue(deployment, 'githubCommitSha') ?? getMetaValue(deployment, 'commitSha'),
        url: typeof deployment.url === 'string' ? `https://${deployment.url}` : undefined,
        startedAt: toDate(deployment.createdAt ?? deployment.created),
        finishedAt: toDate(deployment.ready),
      },
    ];
  }

  private normalizeJenkins(payload: unknown): NormalizedDeployment[] {
    const root = (payload ?? {}) as JenkinsWebhookPayload;
    const build = root.build ?? {};

    if (typeof build.number !== 'number' && typeof build.number !== 'string') return [];

    return [
      {
        externalId: String(build.number),
        status: mapJenkinsStatus(build.status),
        commitSha: build.scm?.commit,
        url: typeof build.url === 'string' ? build.url : undefined,
        startedAt: build.timestamp ? new Date(build.timestamp) : new Date(),
      },
    ];
  }

  private async findProjectForWebhook(
    provider: WebhookProvider,
    payload: unknown,
  ): Promise<{ id: string; name: string; provider: Provider } | null> {
    if (provider === 'VERCEL') {
      const root = (payload ?? {}) as VercelWebhookPayload;
      const deployment = (root.payload ?? root) as Record<string, unknown>;

      if (typeof deployment.projectId === 'string') {
        return prisma.project.findFirst({
          where: {
            provider: 'VERCEL',
            providerConfig: { path: ['vercelProjectId'], equals: deployment.projectId },
          },
          select: { id: true, name: true, provider: true },
        });
      }

      return this.singleProjectOrNull('VERCEL');
    }

    const root = (payload ?? {}) as JenkinsWebhookPayload;
    const jobName = root.project?.name ?? root.name;

    if (typeof jobName === 'string') {
      return prisma.project.findFirst({
        where: {
          provider: 'JENKINS',
          providerConfig: { path: ['jobName'], equals: jobName },
        },
        select: { id: true, name: true, provider: true },
      });
    }

    return this.singleProjectOrNull('JENKINS');
  }

  private async singleProjectOrNull(
    provider: Provider,
  ): Promise<{ id: string; name: string; provider: Provider } | null> {
    const projects = await prisma.project.findMany({
      where: { provider },
      select: { id: true, name: true, provider: true },
    });
    return projects.length === 1 ? projects[0] : null;
  }
}

function mapVercelStatus(state: string): NormalizedDeployment['status'] {
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
      return 'RUNNING';
  }
}

function mapJenkinsStatus(status?: string): NormalizedDeployment['status'] {
  switch (status) {
    case 'SUCCESS':
    case 'SUCCESSFUL':
      return 'SUCCESS';
    case 'FAILURE':
    case 'FAILED':
    case 'UNSTABLE':
      return 'FAILED';
    case 'ABORTED':
      return 'CANCELLED';
    case 'QUEUED':
      return 'QUEUED';
    case 'BUILDING':
      return 'RUNNING';
    default:
      return 'RUNNING';
  }
}

function getMetaValue(deployment: Record<string, unknown>, key: string): string | undefined {
  const meta = deployment.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const value = (meta as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function toDate(value: unknown): Date {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? new Date(n) : new Date();
}

export const webhookService = new WebhookService();