import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();

describe('deployments history API', () => {
  let adminToken: string;
  let projectId: string;

  before(async () => {
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await request(app).post('/api/auth/register').send({
      name: 'Deployments Test Admin',
      email: 'depl-admin@test.dev',
      password: 'supersecret123',
    });

    const login = await request(app).post('/api/auth/login').send({
      email: 'depl-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = login.body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Deployments Project', provider: 'VERCEL' });
    projectId = project.body.id;

    const base = Date.now();
    await prisma.deployment.createMany({
      data: [
        { projectId, provider: 'VERCEL', status: 'SUCCESS', externalId: 'dpl_1', startedAt: new Date(base - 3000), finishedAt: new Date(base - 2000) },
        { projectId, provider: 'VERCEL', status: 'RUNNING', externalId: 'dpl_2', startedAt: new Date(base - 2000) },
        { projectId, provider: 'VERCEL', status: 'FAILED', externalId: 'dpl_3', startedAt: new Date(base - 1000), finishedAt: new Date(base - 500) },
      ],
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('lists deployments paginated, newest first', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/deployments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 2, offset: 0 });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 2);
    assert.equal(res.body.total, 3);
    assert.equal(res.body.limit, 2);
    assert.equal(res.body.offset, 0);

    // startedAt desc → dpl_3 (más reciente) primero.
    assert.equal(res.body.data[0].externalId, 'dpl_3');
    assert.equal(res.body.data[1].externalId, 'dpl_2');
  });

  it('returns the remaining deployments on the second page', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/deployments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 2, offset: 2 });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].externalId, 'dpl_1');
  });

  it('returns 404 for an unknown project', async () => {
    const res = await request(app)
      .get('/api/projects/00000000-0000-4000-8000-000000000000/deployments')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 404);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/deployments`);
    assert.equal(res.status, 401);
  });
});
