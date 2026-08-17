import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();

describe('audit logs API', () => {
  let adminToken: string;
  let viewerToken: string;

  before(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    const register = await request(app).post('/api/auth/register').send({
      name: 'Audit Admin',
      email: 'audit-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = register.body.accessToken;

    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Audit Viewer', email: 'audit-viewer@test.dev', password: 'supersecret123', role: 'VIEWER' });

    const viewerLogin = await request(app).post('/api/auth/login').send({
      email: 'audit-viewer@test.dev',
      password: 'supersecret123',
    });
    viewerToken = viewerLogin.body.accessToken;
  });

  it('records register and login events', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      name: 'Audit User',
      email: 'audit-user@test.dev',
      password: 'supersecret123',
    });
    const uid = reg.body.user.id;

    await request(app).post('/api/auth/login').send({
      email: 'audit-user@test.dev',
      password: 'supersecret123',
    });

    const logs = await prisma.auditLog.findMany({ where: { userId: uid } });
    const actions = logs.map((l) => l.action).sort();

    assert.ok(actions.includes('auth.register'));
    assert.ok(actions.includes('auth.login'));
  });

  it('records project creation', async () => {
    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Audit Project', provider: 'VERCEL' });

    assert.equal(project.status, 201);

    const logs = await prisma.auditLog.findMany({
      where: { resourceType: 'PROJECT', resourceId: project.body.id },
    });
    assert.ok(logs.some((l) => l.action === 'project.create'));
  });

  it('requires ADMIN to list audit logs', async () => {
    const asViewer = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${viewerToken}`);
    assert.equal(asViewer.status, 403);

    const unauthenticated = await request(app).get('/api/audit-logs');
    assert.equal(unauthenticated.status, 401);
  });

  it('lists audit logs with pagination for ADMIN', async () => {
    const res = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.total >= 3);
    assert.equal(res.body.limit, 20);
  });

  it('filters by action', async () => {
    const res = await request(app)
      .get('/api/audit-logs?action=auth.login')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    assert.ok(res.body.data.every((l: { action: string }) => l.action === 'auth.login'));
  });

  it('validates filters', async () => {
    const res = await request(app)
      .get('/api/audit-logs?userId=not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(res.status, 400);
  });
});