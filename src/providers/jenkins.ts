import type { Project } from '@prisma/client';
import type { DeploymentProvider, NormalizedDeployment } from './types';
import { AuthError, ProviderError } from './types';

const BUILD_TREE = 'builds[number,result,timestamp,duration,url,building]';

interface JenkinsBuild {
  number: number;
  result: string | null;
  timestamp: number;
  duration: number;
  url: string;
  building: boolean;
}

interface JenkinsConfig {
  jenkinsUrl?: unknown;
  jobName?: unknown;
}

function getConfig(project: Project): { base: string; jobPath: string } {
  const config = (project.providerConfig ?? {}) as JenkinsConfig;

  if (typeof config.jenkinsUrl !== 'string' || typeof config.jobName !== 'string') {
    throw new ProviderError('providerConfig must include "jenkinsUrl" and "jobName" for JENKINS');
  }

  const base = config.jenkinsUrl.replace(/\/+$/, '');
  const jobPath = `/job/${encodeURIComponent(config.jobName)}`;

  return { base, jobPath };
}

function basicAuth(secret: string): string {
  return `Basic ${Buffer.from(secret).toString('base64')}`;
}

function mapResult(result: string | null): NormalizedDeployment['status'] {
  switch (result) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'ABORTED':
    case 'NOT_BUILT':
      return 'CANCELLED';
    default:
      // FAILURE, UNSTABLE, ...
      return 'FAILED';
  }
}

function mapBuild(build: JenkinsBuild): NormalizedDeployment {
  return {
    externalId: String(build.number),
    status: build.building ? 'RUNNING' : mapResult(build.result),
    url: build.url,
    logUrl: build.url ? new URL('consoleText', build.url).toString() : undefined,
    startedAt: new Date(build.timestamp),
    finishedAt: build.building ? undefined : new Date(build.timestamp + build.duration),
  };
}

export class JenkinsProvider implements DeploymentProvider {
  name = 'JENKINS' as const;

  async fetchDeployments(project: Project, secret: string): Promise<NormalizedDeployment[]> {
    const { base, jobPath } = getConfig(project);

    const url = new URL(`${base}${jobPath}/api/json`);
    url.searchParams.set('tree', BUILD_TREE);

    const res = await fetch(url, {
      headers: { Authorization: basicAuth(secret) },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`Jenkins rejected the credentials (HTTP ${res.status})`);
      }
      throw new ProviderError(`Jenkins API error (HTTP ${res.status})`);
    }

    const body = (await res.json()) as { builds?: JenkinsBuild[] };
    return (body.builds ?? []).map(mapBuild);
  }

  async triggerDeploy(project: Project, secret: string): Promise<void> {
    const { base, jobPath } = getConfig(project);
    const auth = basicAuth(secret);

    // Jenkins moderno exige CSRF crumb para POSTs; si el endpoint no existe, se ignora.
    const crumbHeaders = await this.fetchCrumb(base, auth);

    const res = await fetch(`${base}${jobPath}/build`, {
      method: 'POST',
      headers: { Authorization: auth, ...crumbHeaders },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`Jenkins rejected the credentials (HTTP ${res.status})`);
      }
      throw new ProviderError(`Jenkins build trigger failed (HTTP ${res.status})`);
    }
  }

  private async fetchCrumb(base: string, auth: string): Promise<Record<string, string>> {
    try {
      const res = await fetch(`${base}/crumbIssuer/api/json`, {
        headers: { Authorization: auth },
      });

      if (!res.ok) return {};

      const body = (await res.json()) as {
        crumb?: string;
        crumbRequestField?: string;
      };

      if (body.crumb && body.crumbRequestField) {
        return { [body.crumbRequestField]: body.crumb };
      }

      return {};
    } catch {
      return {};
    }
  }
}
