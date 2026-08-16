import type { Project, Provider } from '@prisma/client';

export type DeploymentStatus = 'SUCCESS' | 'FAILED' | 'RUNNING' | 'CANCELLED' | 'QUEUED';

export interface NormalizedDeployment {
  externalId: string;
  status: DeploymentStatus;
  commitSha?: string;
  url?: string;
  logUrl?: string;
  startedAt: Date;
  finishedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface DeploymentProvider {
  name: Provider;
  fetchDeployments(project: Project, secret: string): Promise<NormalizedDeployment[]>;
  triggerDeploy?(project: Project, secret: string): Promise<void>;
}

export class ProviderError extends Error {}
export class AuthError extends ProviderError {}
