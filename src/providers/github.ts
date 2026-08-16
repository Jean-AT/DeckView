import type { Project } from '@prisma/client';
import type { DeploymentProvider, NormalizedDeployment } from './types';
import { AuthError, ProviderError } from './types';

const GITHUB_API = 'https://api.github.com';

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
  run_started_at: string;
  updated_at: string;
  html_url: string;
}

function mapStatus(status: string, conclusion: string | null): NormalizedDeployment['status'] {
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
      case 'neutral':
      case 'skipped':
        return 'SUCCESS';
      case 'cancelled':
        return 'CANCELLED';
      case 'action_required':
        return 'QUEUED';
      default:
        // failure, timed_out, startup_failure, stale, ...
        return 'FAILED';
    }
  }

  if (status === 'queued' || status === 'waiting' || status === 'requested' || status === 'pending') {
    return 'QUEUED';
  }

  // in_progress, action_required, ...
  return 'RUNNING';
}

function mapRun(run: WorkflowRun): NormalizedDeployment {
  const finishedAt =
    run.status === 'completed' && run.conclusion
      ? new Date(run.updated_at)
      : undefined;

  return {
    externalId: String(run.id),
    status: mapStatus(run.status, run.conclusion),
    commitSha: run.head_sha,
    url: run.html_url,
    startedAt: new Date(run.run_started_at),
    finishedAt,
  };
}

export class GitHubActionsProvider implements DeploymentProvider {
  name = 'GITHUB_ACTIONS' as const;

  async fetchDeployments(project: Project, secret: string): Promise<NormalizedDeployment[]> {
    const config = (project.providerConfig ?? {}) as {
      owner?: unknown;
      repo?: unknown;
    };

    if (typeof config.owner !== 'string' || typeof config.repo !== 'string') {
      throw new ProviderError(
        'providerConfig must include "owner" and "repo" for GITHUB_ACTIONS',
      );
    }

    const url = new URL(`${GITHUB_API}/repos/${config.owner}/${config.repo}/actions/runs`);
    url.searchParams.set('per_page', '100');

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'devops-dashboard-backend',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`GitHub rejected the token (HTTP ${res.status})`);
      }
      throw new ProviderError(`GitHub API error (HTTP ${res.status})`);
    }

    const body = (await res.json()) as { workflow_runs?: WorkflowRun[] };
    return (body.workflow_runs ?? []).map(mapRun);
  }
}
