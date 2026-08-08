import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

const app = createApp();

describe('users API', () => {
  let adminToken: string;
  let devToken: string;
  let viewerToken: string;
  let createdUserId: string;

  before(async () => {
    await prisma.user.deleteMany();

    // Primer registro = ADMIN (necesario para poder usar /api/users).
    await request(app).post('/api/auth/register').send({
      name: 'Users Test Admin',
      email: 'users-admin@test.dev',
      password: 'supersecret123',
    });

    const adminLogin = await request(app).post('/api/auth/login').send({
      email: 'users-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = adminLogin.body.accessToken;

    // Crear un DEVELOPER y un VIEWER vía API (con el token de admin).
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Users Test Dev',
        email: 'users-dev@test.dev',
        password: 'supersecret123',
        role: 'DEVELOPER',
      });

    const devLogin = await request(app).post('/api/auth/login').send({
      email: 'users-dev@test.dev',
      password: 'supersecret123',
    });
    devToken = devLogin.body.accessToken;

    const viewer = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Users Test Viewer',
        email: 'users-viewer@test.dev',
        password: 'supersecret123',
        role: 'VIEWER',
      });

    const viewerLogin = await request(app).post('/api/auth/login').send({
      email: 'users-viewer@test.dev',
      password: 'supersecret123',
    });
    viewerToken = viewerLogin.body.accessToken;

    createdUserId = viewer.body.id;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('[ADMIN] creates a user with chosen role and never returns password', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'New Developer',
        email: 'new-dev@test.dev',
        password: 'supersecret123',
        role: 'DEVELOPER',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.role, 'DEVELOPER');
    assert.equal(res.body.email, 'new-dev@test.dev');
    assert.ok(res.body.id);
    assert.ok(!('password' in res.body));
  });

  it('[ADMIN] lists users paginated with { data, total, limit, offset }', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 2, offset: 0 });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 2);
    assert.equal(typeof res.body.total, 'number');
    assert.equal(res.body.limit, 2);
    assert.equal(res.body.offset, 0);
    assert.ok(!('password' in res.body.data[0]));
  });

  it('[ADMIN] gets a user by id', async () => {
    const res = await request(app)
      .get(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.id, createdUserId);
    assert.equal(res.body.email, 'users-viewer@test.dev');
  });

  it('[ADMIN] returns 404 for an unknown user id', async () => {
    const res = await request(app)
      .get('/api/users/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 404);
  });

  it('[ADMIN] updates name/email/role', async () => {
    const res = await request(app)
      .patch(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Viewer Renamed', role: 'VIEWER' });

    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'Viewer Renamed');
    assert.equal(res.body.role, 'VIEWER');
  });

  it('[ADMIN] rejects an update with a duplicated email', async () => {
    const res = await request(app)
      .patch(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'users-admin@test.dev' });

    assert.equal(res.status, 409);
  });

  it('[ADMIN] rejects updating own role', async () => {
    const admin = await prisma.user.findUnique({ where: { email: 'users-admin@test.dev' } });

    const res = await request(app)
      .patch(`/api/users/${admin!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'VIEWER' });

    assert.equal(res.status, 400);
  });

  it('[ADMIN] deletes a user', async () => {
    const res = await request(app)
      .delete(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 204);

    const after = await request(app)
      .get(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    assert.equal(after.status, 404);
  });

  it('[ADMIN] cannot delete their own account', async () => {
    const admin = await prisma.user.findUnique({ where: { email: 'users-admin@test.dev' } });

    const res = await request(app)
      .delete(`/api/users/${admin!.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 400);
  });

  it('rejects invalid body (bad email, short password, unknown role)', async () => {
    const badEmail = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', email: 'not-an-email', password: 'supersecret123', role: 'VIEWER' });
    assert.equal(badEmail.status, 400);

    const shortPassword = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', email: 'x@test.dev', password: 'short', role: 'VIEWER' });
    assert.equal(shortPassword.status, 400);

    const badRole = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', email: 'y@test.dev', password: 'supersecret123', role: 'SUPERADMIN' });
    assert.equal(badRole.status, 400);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/users');
    assert.equal(res.status, 401);
  });

  it('rejects a VIEWER from creating users', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        name: 'Should Fail',
        email: 'should-fail@test.dev',
        password: 'supersecret123',
        role: 'VIEWER',
      });

    assert.equal(res.status, 403);
  });

  it('rejects a DEVELOPER from listing users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${devToken}`);

    assert.equal(res.status, 403);
  });
});
