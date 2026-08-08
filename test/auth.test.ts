import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { verifyToken } from '../src/utils/jwt';

const app = createApp();

describe('auth API', () => {
  before(async () => {
    await prisma.user.deleteMany();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('first registered user becomes ADMIN, tokens are issued', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'First Admin',
      email: 'admin@test.dev',
      password: 'supersecret123',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'ADMIN');
    assert.ok(res.body.accessToken);
    assert.ok(res.body.refreshToken);

    const payload = verifyToken(res.body.accessToken, 'access');
    assert.equal(payload.role, 'ADMIN');
  });

  it('second registered user becomes VIEWER', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Viewer Person',
      email: 'viewer@test.dev',
      password: 'supersecret123',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'VIEWER');
  });

  it('rejects duplicate email registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Duplicated',
      email: 'admin@test.dev',
      password: 'supersecret123',
    });

    assert.equal(res.status, 409);
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'admin@test.dev',
      password: 'supersecret123',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'admin@test.dev');
    assert.ok(res.body.accessToken);
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'admin@test.dev',
      password: 'wrongpassword',
    });

    assert.equal(res.status, 401);
  });

  it('refreshes tokens with a valid refresh token', async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: 'admin@test.dev',
      password: 'supersecret123',
    });

    const res = await request(app).post('/api/auth/refresh').send({
      refreshToken: login.body.refreshToken,
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    assert.ok(res.body.refreshToken);
  });

  it('rejects an access token used as a refresh token', async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: 'admin@test.dev',
      password: 'supersecret123',
    });

    const res = await request(app).post('/api/auth/refresh').send({
      refreshToken: login.body.accessToken,
    });

    assert.equal(res.status, 401);
  });

  it('requires auth for /api/auth/me', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  it('returns the current user from /api/auth/me', async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: 'admin@test.dev',
      password: 'supersecret123',
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'admin@test.dev');
  });
});
