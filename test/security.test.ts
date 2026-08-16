import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { SyncService, syncService } from '../src/services/syncService';

const app = createApp();

async function registerAndLogin(name: string, email: string): Promise<string> {
  await request(app).post('/api/auth/register').send({
    name,
    email,
    password: 'supersecret123',
  });
  const login = await request(app).post('/api/auth/login').send({
    email,
    password: 'supersecret123',
  });
  return login.body.accessToken;
}

describe('security: health, 404 and error handling', () => {
  it('exposes /health', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not found');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"name": "broken');

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid JSON body');
  });
});

describe('security: credential and password leakage', () => {
  let adminToken: string;
  let projectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    adminToken = await registerAndLogin('Leak Admin', 'leak-admin@test.dev');

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Leak Project',
        provider: 'VERCEL',
        providerConfig: { vercelProjectId: 'prj_leak' },
      });
    projectId = project.body.id;

    await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'VERCEL', value: 'vercel_supersecretvalue123456' });
  });

  it('never returns the raw credential value', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);

    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes('vercel_supersecretvalue123456'));
    assert.ok(!serialized.includes('valueCiphertext'));
    assert.ok(!serialized.includes('valueIv'));
    assert.ok(!serialized.includes('valueTag'));
    assert.ok(res.body.data[0].maskedPreview === '••••3456');
  });

  it('never returns password hashes on any user endpoint', async () => {
    const list = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);

    for (const res of [list, me]) {
      const serialized = JSON.stringify(res.body);
      assert.ok(!serialized.includes('password'));
      assert.ok(!serialized.includes('$2a$'));
    }

    const detail = await request(app)
      .get(`/api/users/${me.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.ok(!JSON.stringify(detail.body).includes('password'));
  });
});

describe('security: role enforcement on write endpoints', () => {
  let adminToken: string;
  let devToken: string;
  let viewerToken: string;
  let projectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    adminToken = await registerAndLogin('Roles Admin', 'roles-admin@test.dev');

    for (const [name, email, role] of [
      ['Roles Dev', 'roles-dev@test.dev', 'DEVELOPER'],
      ['Roles Viewer', 'roles-viewer@test.dev', 'VIEWER'],
    ]) {
      await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name, email, password: 'supersecret123', role });
    }

    devToken = (
      await request(app).post('/api/auth/login').send({
        email: 'roles-dev@test.dev',
        password: 'supersecret123',
      })
    ).body.accessToken;

    viewerToken = (
      await request(app).post('/api/auth/login').send({
        email: 'roles-viewer@test.dev',
        password: 'supersecret123',
      })
    ).body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Roles Project',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'roles' },
      });
    projectId = project.body.id;
  });

  it('VIEWER cannot create, update or delete projects', async () => {
    const create = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Nope', provider: 'VERCEL' });
    assert.equal(create.status, 403);

    const update = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Nope' });
    assert.equal(update.status, 403);

    const remove = await request(app)
      .delete(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    assert.equal(remove.status, 403);
  });

  it('DEVELOPER can manage projects but not sync or manage credentials', async () => {
    const update = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ name: 'Roles Project Updated' });
    assert.equal(update.status, 200);

    const sync = await request(app)
      .post(`/api/projects/${projectId}/sync`)
      .set('Authorization', `Bearer ${devToken}`);
    assert.equal(sync.status, 403);

    const createCredential = await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ provider: 'JENKINS', value: 'user:apitoken12345' });
    assert.equal(createCredential.status, 403);

    const listCredential = await request(app)
      .get(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${devToken}`);
    assert.equal(listCredential.status, 403);
  });

  it('VIEWER can read deployments and tickets', async () => {
    const deployments = await request(app)
      .get(`/api/projects/${projectId}/deployments`)
      .set('Authorization', `Bearer ${viewerToken}`);
    assert.equal(deployments.status, 200);

    const tickets = await request(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${viewerToken}`);
    assert.equal(tickets.status, 200);
  });
});

describe('security: outbound rate limiting', () => {
  let adminToken: string;
  let projectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    adminToken = await registerAndLogin('Rate Admin', 'rate-admin@test.dev');

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Rate Project',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'rate' },
      });
    projectId = project.body.id;

    await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'JENKINS', value: 'user:apitoken12345' });
  });

  it('syncProject returns rate_limited when the limiter denies', async () => {
    const limitedService = new SyncService({ allow: () => false });

    const result = await limitedService.syncProject(projectId);
    assert.equal(result.status, 'rate_limited');
    assert.equal(result.error, 'Outbound rate limit exceeded');
  });

  it('the route maps rate_limited to 429', async () => {
    const svc = syncService as unknown as { limiter: { allow(key: string): boolean } };
    const original = svc.limiter;
    svc.limiter = { allow: () => false };

    try {
      const res = await request(app)
        .post(`/api/projects/${projectId}/sync`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.equal(res.status, 429);
      assert.equal(res.body.status, 'rate_limited');
    } finally {
      svc.limiter = original;
    }
  });
});
