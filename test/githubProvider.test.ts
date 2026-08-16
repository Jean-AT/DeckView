import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { GitHubActionsProvider } from '../src/providers/github';
import { AuthError, ProviderError } from '../src/providers/types';
import { providerRegistry } from '../src/providers';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { syncService } from '../src/services/syncService';

const app = createApp();
const provider = new GitHubActionsProvider();

const project = {
  provider: 'GITHUB_ACTIONS',
  providerConfig: { owner: 'acme', repo: 'web-app' },
} as never;

let originalFetch: typeof fetch;

before(() => {
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHubActionsProvider', () => {
  it('maps workflow runs to NormalizedDeployment', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.ok(url.startsWith('https://api.github.com/repos/acme/web-app/actions/runs'));
      assert.ok(url.includes('per_page=100'));

      return jsonResponse({
        workflow_runs: [
          {
            id: 1001,
            status: 'completed',
            conclusion: 'success',
            head_sha: 'abc111',
            run_started_at: '2026-08-08T10:00:00Z',
            updated_at: '2026-08-08T10:05:00Z',
            html_url: 'https://github.com/acme/web-app/actions/runs/1001',
          },
          {
            id: 1002,
            status: 'in_progress',
            conclusion: null,
            head_sha: 'def222',
            run_started_at: '2026-08-08T11:00:00Z',
            updated_at: '2026-08-08T11:01:00Z',
            html_url: 'https://github.com/acme/web-app/actions/runs/1002',
          },
          {
            id: 1003,
            status: 'completed',
            conclusion: 'failure',
            head_sha: 'ghi333',
            run_started_at: '2026-08-08T12:00:00Z',
            updated_at: '2026-08-08T12:02:00Z',
            html_url: 'https://github.com/acme/web-app/actions/runs/1003',
          },
          {
            id: 1004,
            status: 'completed',
            conclusion: 'cancelled',
            head_sha: 'jkl444',
            run_started_at: '2026-08-08T13:00:00Z',
            updated_at: '2026-08-08T13:01:00Z',
            html_url: 'https://github.com/acme/web-app/actions/runs/1004',
          },
        ],
      });
    };

    const result = await provider.fetchDeployments(project, 'github_pat_token');

    assert.equal(result.length, 4);
    assert.equal(result[0].status, 'SUCCESS');
    assert.deepEqual(result[0].finishedAt, new Date('2026-08-08T10:05:00Z'));
    assert.equal(result[1].status, 'RUNNING');
    assert.equal(result[1].finishedAt, undefined);
    assert.equal(result[2].status, 'FAILED');
    assert.equal(result[3].status, 'CANCELLED');
    assert.equal(result[0].externalId, '1001');
    assert.equal(result[0].commitSha, 'abc111');
  });

  it('sends the token as a Bearer Authorization header', async () => {
    let seenAuthorization: string | undefined;

    globalThis.fetch = async (_input, init) => {
      seenAuthorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return jsonResponse({ workflow_runs: [] });
    };

    await provider.fetchDeployments(project, 'github_pat_token');
    assert.equal(seenAuthorization, 'Bearer github_pat_token');
  });

  it('throws AuthError on 401', async () => {
    globalThis.fetch = async () => new Response('Bad credentials', { status: 401 });
    await assert.rejects(() => provider.fetchDeployments(project, 'bad'), AuthError);
  });

  it('throws ProviderError on 404 (repo not found or no access)', async () => {
    globalThis.fetch = async () => new Response('Not Found', { status: 404 });
    await assert.rejects(() => provider.fetchDeployments(project, 'tok'), ProviderError);
  });

  it('throws ProviderError when owner/repo are missing from providerConfig', async () => {
    await assert.rejects(
      () => provider.fetchDeployments({ provider: 'GITHUB_ACTIONS', providerConfig: {} } as never, 'tok'),
      ProviderError,
    );
  });

  it('registry resolves both registered providers', () => {
    assert.equal(providerRegistry.get('VERCEL').name, 'VERCEL');
    assert.equal(providerRegistry.get('GITHUB_ACTIONS').name, 'GITHUB_ACTIONS');
  });
});

describe('GitHub sync end-to-end (2-provider registry)', () => {
  let adminToken: string;
  let projectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await request(app).post('/api/auth/register').send({
      name: 'GitHub Sync Admin',
      email: 'gh-admin@test.dev',
      password: 'supersecret123',
    });

    const login = await request(app).post('/api/auth/login').send({
      email: 'gh-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = login.body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'GitHub Project',
        provider: 'GITHUB_ACTIONS',
        providerConfig: { owner: 'acme', repo: 'web-app' },
      });
    projectId = project.body.id;

    await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'GITHUB_ACTIONS', value: 'github_pat_1234567890abcdefghijklmnop' });
  });

  it('syncs GitHub Actions runs through the registry', async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        workflow_runs: [
          {
            id: 2001,
            status: 'completed',
            conclusion: 'success',
            head_sha: 'deadbeef',
            run_started_at: '2026-08-08T09:00:00Z',
            updated_at: '2026-08-08T09:03:00Z',
            html_url: 'https://github.com/acme/web-app/actions/runs/2001',
          },
        ],
      });

    const result = await syncService.syncProject(projectId);
    assert.equal(result.status, 'ok');
    assert.equal(result.count, 1);

    const row = await prisma.deployment.findFirst({ where: { projectId } });
    assert.equal(row!.externalId, '2001');
    assert.equal(row!.status, 'SUCCESS');
    assert.equal(row!.commitSha, 'deadbeef');
    assert.equal(row!.provider, 'GITHUB_ACTIONS');
  });
});
