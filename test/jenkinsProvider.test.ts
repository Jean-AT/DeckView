import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { JenkinsProvider } from '../src/providers/jenkins';
import { AuthError, ProviderError } from '../src/providers/types';
import { providerRegistry } from '../src/providers';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { syncService } from '../src/services/syncService';

const app = createApp();
const provider = new JenkinsProvider();

const project = {
  provider: 'JENKINS',
  providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'deploy-app' },
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

describe('JenkinsProvider', () => {
  it('maps builds to NormalizedDeployment', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.ok(url.includes('/job/deploy-app/api/json'));
      assert.ok(url.includes('tree=builds'));

      return jsonResponse({
        builds: [
          {
            number: 12,
            result: 'SUCCESS',
            timestamp: 1723122000000,
            duration: 60000,
            url: 'http://jenkins:8080/job/deploy-app/12/',
            building: false,
          },
          {
            number: 13,
            result: null,
            timestamp: 1723122600000,
            duration: 0,
            url: 'http://jenkins:8080/job/deploy-app/13/',
            building: true,
          },
          {
            number: 11,
            result: 'FAILURE',
            timestamp: 1723121000000,
            duration: 30000,
            url: 'http://jenkins:8080/job/deploy-app/11/',
            building: false,
          },
          {
            number: 10,
            result: 'ABORTED',
            timestamp: 1723120000000,
            duration: 10000,
            url: 'http://jenkins:8080/job/deploy-app/10/',
            building: false,
          },
        ],
      });
    };

    const result = await provider.fetchDeployments(project, 'user:apitoken');

    assert.equal(result.length, 4);
    assert.equal(result[0].status, 'SUCCESS');
    assert.equal(result[0].externalId, '12');
    assert.equal(result[0].logUrl, 'http://jenkins:8080/job/deploy-app/12/consoleText');
    assert.equal(result[1].status, 'RUNNING');
    assert.equal(result[1].finishedAt, undefined);
    assert.equal(result[2].status, 'FAILED');
    assert.equal(result[3].status, 'CANCELLED');
    assert.deepEqual(
      result[0].finishedAt,
      new Date(1723122000000 + 60000),
    );
  });

  it('sends Basic auth with user:token', async () => {
    let seenAuthorization: string | undefined;

    globalThis.fetch = async (_input, init) => {
      seenAuthorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return jsonResponse({ builds: [] });
    };

    await provider.fetchDeployments(project, 'user:apitoken');
    assert.equal(
      seenAuthorization,
      `Basic ${Buffer.from('user:apitoken').toString('base64')}`,
    );
  });

  it('throws AuthError on 401', async () => {
    globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });
    await assert.rejects(() => provider.fetchDeployments(project, 'bad'), AuthError);
  });

  it('throws ProviderError on 404 (job not found)', async () => {
    globalThis.fetch = async () => new Response('Not Found', { status: 404 });
    await assert.rejects(() => provider.fetchDeployments(project, 'tok'), ProviderError);
  });

  it('throws ProviderError when config is missing', async () => {
    await assert.rejects(
      () => provider.fetchDeployments({ provider: 'JENKINS', providerConfig: {} } as never, 'tok'),
      ProviderError,
    );
  });

  it('registry resolves JENKINS', () => {
    assert.equal(providerRegistry.get('JENKINS').name, 'JENKINS');
  });

  it('triggerDeploy POSTs to /build with csrf crumb', async () => {
    const calls: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: (init?.method as string) ?? 'GET', headers: init?.headers as Record<string, string> });

      if (url.includes('/crumbIssuer/api/json')) {
        return jsonResponse({ crumb: 'crumb123', crumbRequestField: 'Jenkins-Crumb' });
      }
      return new Response(null, { status: 200 });
    };

    await provider.triggerDeploy(project, 'user:apitoken');

    assert.equal(calls[0].url, 'http://jenkins:8080/crumbIssuer/api/json');
    assert.equal(calls[1].url, 'http://jenkins:8080/job/deploy-app/build');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].headers?.['Jenkins-Crumb'], 'crumb123');
  });

  it('triggerDeploy proceeds without crumb when crumb endpoint is missing', async () => {
    const calls: string[] = [];

    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/crumbIssuer/api/json')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(null, { status: 200 });
    };

    await provider.triggerDeploy(project, 'user:apitoken');
    assert.equal(calls.length, 2);
  });

  it('triggerDeploy throws AuthError on 403', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/crumbIssuer/api/json')) return jsonResponse({ crumb: 'c', crumbRequestField: 'Jenkins-Crumb' });
      return new Response('Forbidden', { status: 403 });
    };

    await assert.rejects(() => provider.triggerDeploy(project, 'bad'), AuthError);
  });
});

describe('Jenkins sync end-to-end', () => {
  let adminToken: string;
  let projectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await request(app).post('/api/auth/register').send({
      name: 'Jenkins Sync Admin',
      email: 'jenkins-admin@test.dev',
      password: 'supersecret123',
    });

    const login = await request(app).post('/api/auth/login').send({
      email: 'jenkins-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = login.body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Jenkins Project',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'deploy-app' },
      });
    projectId = project.body.id;

    await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'JENKINS', value: 'user:apitoken12345' });
  });

  it('syncs Jenkins builds through the registry', async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        builds: [
          {
            number: 42,
            result: 'SUCCESS',
            timestamp: 1723122000000,
            duration: 120000,
            url: 'http://jenkins:8080/job/deploy-app/42/',
            building: false,
          },
        ],
      });

    const result = await syncService.syncProject(projectId);
    assert.equal(result.status, 'ok');
    assert.equal(result.count, 1);

    const row = await prisma.deployment.findFirst({ where: { projectId } });
    assert.equal(row!.externalId, '42');
    assert.equal(row!.status, 'SUCCESS');
    assert.equal(row!.provider, 'JENKINS');
    assert.equal(row!.durationMs, 120000);
  });

  it('POST /api/projects/:id/trigger returns unsupported for a provider without trigger', async () => {
    const vercelProject = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Vercel No Trigger',
        provider: 'VERCEL',
        providerConfig: { projectId: 'prj_test' },
      });

    const res = await request(app)
      .post(`/api/projects/${vercelProject.body.id}/trigger`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 400);
    assert.equal(res.body.status, 'unsupported');
  });

  it('POST /api/projects/:id/trigger works for JENKINS', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/crumbIssuer/api/json')) return jsonResponse({});
      return new Response(null, { status: 200 });
    };

    const res = await request(app)
      .post(`/api/projects/${projectId}/trigger`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('POST /api/projects/:id/trigger rejects VIEWER', async () => {
    await request(app).post('/api/auth/register').send({
      name: 'Jenkins Viewer',
      email: 'jenkins-viewer@test.dev',
      password: 'supersecret123',
    });

    const login = await request(app).post('/api/auth/login').send({
      email: 'jenkins-viewer@test.dev',
      password: 'supersecret123',
    });

    const res = await request(app)
      .post(`/api/projects/${projectId}/trigger`)
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    assert.equal(res.status, 403);
  });
});
