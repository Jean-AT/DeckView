import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { syncService } from '../src/services/syncService';

const app = createApp();

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

const vercelDeployments = (overrides: Array<Record<string, unknown>> = []) =>
  jsonResponse({
    deployments: [
      { uid: 'dpl_a', state: 'READY', createdAt: 1000, ready: 5000, meta: { githubCommitSha: 'aaa111' } },
      { uid: 'dpl_b', state: 'QUEUED', createdAt: 2000 },
      ...overrides,
    ],
  });

describe('SyncService', () => {
  let adminToken: string;
  let projectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await request(app).post('/api/auth/register').send({
      name: 'Sync Test Admin',
      email: 'sync-admin@test.dev',
      password: 'supersecret123',
    });

    const login = await request(app).post('/api/auth/login').send({
      email: 'sync-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = login.body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Sync Project', provider: 'VERCEL', providerConfig: { vercelProjectId: 'prj_sync' } });
    projectId = project.body.id;

    await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'VERCEL', value: 'vercel_abcdefghijklmnopqrstuvwxyz' });
  });

  it('skips projects without a stored credential', async () => {
    const noCredentialProject = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'No Credential', provider: 'GITHUB_ACTIONS' });

    const result = await syncService.syncProject(noCredentialProject.body.id);
    assert.equal(result.status, 'skipped');
  });

  it('fetches deployments from Vercel and persists them idempotently', async () => {
    globalThis.fetch = async () => vercelDeployments();

    const first = await syncService.syncProject(projectId);
    assert.equal(first.status, 'ok');
    assert.equal(first.count, 2);

    const second = await syncService.syncProject(projectId);
    assert.equal(second.status, 'ok');
    assert.equal(second.count, 2);

    const rows = await prisma.deployment.findMany({ where: { projectId } });
    assert.equal(rows.length, 2);

    const dplA = rows.find((r) => r.externalId === 'dpl_a');
    assert.equal(dplA!.status, 'SUCCESS');
    assert.equal(dplA!.commitSha, 'aaa111');
    assert.equal(dplA!.durationMs, 4000);
  });

  it('updates status of an existing deployment on re-sync', async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        deployments: [
          { uid: 'dpl_b', state: 'READY', createdAt: 2000, ready: 6000 },
          { uid: 'dpl_c', state: 'ERROR', createdAt: 3000 },
        ],
      });

    const result = await syncService.syncProject(projectId);
    assert.equal(result.status, 'ok');
    assert.equal(result.count, 2);

    const dplB = await prisma.deployment.findFirst({ where: { projectId, externalId: 'dpl_b' } });
    assert.equal(dplB!.status, 'SUCCESS');

    const dplC = await prisma.deployment.findFirst({ where: { projectId, externalId: 'dpl_c' } });
    assert.equal(dplC!.status, 'FAILED');
  });

  it('marks the credential as invalid when the provider rejects the token', async () => {
    globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });

    const result = await syncService.syncProject(projectId);
    assert.equal(result.status, 'auth_error');

    const credential = await prisma.providerCredential.findFirst({
      where: { projectId, provider: 'VERCEL' },
    });
    assert.equal(credential!.isValid, false);
  });

  it('returns ok via the manual sync endpoint and stores deployments', async () => {
    await prisma.deployment.deleteMany({ where: { projectId } });

    globalThis.fetch = async () => vercelDeployments();

    const res = await request(app)
      .post(`/api/projects/${projectId}/sync`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.count, 2);

    const rows = await prisma.deployment.count({ where: { projectId } });
    assert.equal(rows, 2);
  });

  it('requires ADMIN for the manual sync endpoint', async () => {
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Sync Test Dev',
        email: 'sync-dev@test.dev',
        password: 'supersecret123',
        role: 'DEVELOPER',
      });

    const devLogin = await request(app).post('/api/auth/login').send({
      email: 'sync-dev@test.dev',
      password: 'supersecret123',
    });

    const res = await request(app)
      .post(`/api/projects/${projectId}/sync`)
      .set('Authorization', `Bearer ${devLogin.body.accessToken}`);

    assert.equal(res.status, 403);
  });

  it('returns an error for an unknown project', async () => {
    const result = await syncService.syncProject('00000000-0000-0000-0000-000000000000');
    assert.equal(result.status, 'error');
    assert.equal(result.error, 'Project not found');
  });

  it('syncAll returns a result per project', async () => {
    const extra = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Sync Extra', provider: 'VERCEL', providerConfig: { vercelProjectId: 'prj_extra' } });

    await request(app)
      .post(`/api/projects/${extra.body.id}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'VERCEL', value: 'vercel_abcdefghijklmnopqrstuvwxyz' });

    globalThis.fetch = async () => vercelDeployments();

    const results = await syncService.syncAll();

    const ok = results.filter((r) => r.status === 'ok');
    assert.equal(ok.length, 2);
    assert.ok(results.some((r) => r.status === 'skipped'));
  });

  it('triggerDeploy returns an error for an unknown project', async () => {
    const result = await syncService.triggerDeploy('00000000-0000-0000-0000-000000000000');
    assert.equal(result.status, 'error');
  });

  it('triggerDeploy skips projects without credentials', async () => {
    const noCred = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Trigger No Cred',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'no-cred' },
      });

    const result = await syncService.triggerDeploy(noCred.body.id);
    assert.equal(result.status, 'skipped');
  });

  it('triggerDeploy marks the credential invalid on auth errors', async () => {
    const jenkins = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Trigger Jenkins Fail',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'trigger-fail' },
      });

    await request(app)
      .post(`/api/projects/${jenkins.body.id}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'JENKINS', value: 'user:apitoken12345' });

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/crumbIssuer/api/json')) return jsonResponse({});
      return new Response('Forbidden', { status: 403 });
    };

    const result = await syncService.triggerDeploy(jenkins.body.id);
    assert.equal(result.status, 'auth_error');

    const credential = await prisma.providerCredential.findFirst({
      where: { projectId: jenkins.body.id, provider: 'JENKINS' },
    });
    assert.equal(credential!.isValid, false);
  });
});
