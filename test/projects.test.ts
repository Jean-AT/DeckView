import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();

describe('projects API', () => {
  let adminToken: string;
  let devToken: string;
  let viewerToken: string;
  let createdProjectId: string;

  before(async () => {
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    // Primer registro = ADMIN.
    await request(app).post('/api/auth/register').send({
      name: 'Projects Test Admin',
      email: 'projects-admin@test.dev',
      password: 'supersecret123',
    });

    const adminLogin = await request(app).post('/api/auth/login').send({
      email: 'projects-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = adminLogin.body.accessToken;

    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Projects Test Dev',
        email: 'projects-dev@test.dev',
        password: 'supersecret123',
        role: 'DEVELOPER',
      });

    const devLogin = await request(app).post('/api/auth/login').send({
      email: 'projects-dev@test.dev',
      password: 'supersecret123',
    });
    devToken = devLogin.body.accessToken;

    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Projects Test Viewer',
        email: 'projects-viewer@test.dev',
        password: 'supersecret123',
        role: 'VIEWER',
      });

    const viewerLogin = await request(app).post('/api/auth/login').send({
      email: 'projects-viewer@test.dev',
      password: 'supersecret123',
    });
    viewerToken = viewerLogin.body.accessToken;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('[ADMIN] creates a project and keeps providerConfig as JSON', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Vercel landing',
        provider: 'VERCEL',
        providerConfig: { vercelProjectId: 'prj_demo_landing' },
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Vercel landing');
    assert.equal(res.body.provider, 'VERCEL');
    assert.deepEqual(res.body.providerConfig, { vercelProjectId: 'prj_demo_landing' });

    createdProjectId = res.body.id;
  });

  it('[ADMIN] rejects an invalid provider', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad Provider', provider: 'KUBERNETES' });

    assert.equal(res.status, 400);
  });

  it('[ADMIN] rejects a project without a name', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'AWS' });

    assert.equal(res.status, 400);
  });

  it('[ADMIN] lists projects paginated with { data, total, limit, offset }', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 10 });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(typeof res.body.total, 'number');
    assert.equal(res.body.limit, 10);
    assert.equal(res.body.offset, 0);
  });

  it('[ADMIN] gets a project by id', async () => {
    const res = await request(app)
      .get(`/api/projects/${createdProjectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.id, createdProjectId);
    assert.equal(res.body.provider, 'VERCEL');
  });

  it('[ADMIN] returns 404 for an unknown project id', async () => {
    const res = await request(app)
      .get('/api/projects/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 404);
  });

  it('[ADMIN] updates name and providerConfig', async () => {
    const res = await request(app)
      .patch(`/api/projects/${createdProjectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Vercel landing v2',
        providerConfig: { vercelProjectId: 'prj_demo_landing_v2', regions: ['iad1'] },
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Vercel landing v2');
    assert.deepEqual(res.body.providerConfig, {
      vercelProjectId: 'prj_demo_landing_v2',
      regions: ['iad1'],
    });
  });

  it('[ADMIN] deletes a project', async () => {
    const res = await request(app)
      .delete(`/api/projects/${createdProjectId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 204);

    const after = await request(app)
      .get(`/api/projects/${createdProjectId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(after.status, 404);
  });

  it('[DEVELOPER] can create a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ name: 'Web GitHub Actions', provider: 'GITHUB_ACTIONS' });

    assert.equal(res.status, 201);
    assert.equal(res.body.provider, 'GITHUB_ACTIONS');
  });

  it('[VIEWER] can list projects', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', `Bearer ${viewerToken}`);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });

  it('[VIEWER] cannot create a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Viewer Project', provider: 'AWS' });

    assert.equal(res.status, 403);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/projects');
    assert.equal(res.status, 401);
  });
});
