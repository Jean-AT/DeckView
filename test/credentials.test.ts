import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { decryptSecret } from '../src/utils/cipher';

const app = createApp();

const VALID_VERCEL_KEY = 'vercel_abcdefghijklmnopqrstuvwxyz';
const VALID_VERCEL_KEY_2 = 'vercel_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('credentials API', () => {
  let adminToken: string;
  let devToken: string;
  let projectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    // Primer registro = ADMIN.
    await request(app).post('/api/auth/register').send({
      name: 'Credentials Test Admin',
      email: 'cred-admin@test.dev',
      password: 'supersecret123',
    });

    const adminLogin = await request(app).post('/api/auth/login').send({
      email: 'cred-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = adminLogin.body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Credentials Project', provider: 'VERCEL' });
    projectId = project.body.id;

    // DEVELOPER para el test de 403.
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Credentials Test Dev',
        email: 'cred-dev@test.dev',
        password: 'supersecret123',
        role: 'DEVELOPER',
      });

    const devLogin = await request(app).post('/api/auth/login').send({
      email: 'cred-dev@test.dev',
      password: 'supersecret123',
    });
    devToken = devLogin.body.accessToken;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('[ADMIN] creates a credential encrypted with masked preview, never exposing the value', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'VERCEL', value: VALID_VERCEL_KEY });

    assert.equal(res.status, 201);
    assert.equal(res.body.provider, 'VERCEL');
    assert.equal(res.body.maskedPreview, `••••${VALID_VERCEL_KEY.slice(-4)}`);
    assert.equal(res.body.isValid, true);
    assert.ok(res.body.id);
    assert.ok(!('value' in res.body));
    assert.ok(!('valueCiphertext' in res.body));
    assert.ok(!('valueIv' in res.body));
    assert.ok(!('valueTag' in res.body));

    // La DB guarda el valor cifrado, no en texto plano.
    const stored = await prisma.providerCredential.findUnique({
      where: { id: res.body.id },
    });
    assert.ok(stored);
    assert.notEqual(stored.valueCiphertext, VALID_VERCEL_KEY);
    assert.equal(
      decryptSecret({
        ciphertext: stored.valueCiphertext,
        iv: stored.valueIv,
        tag: stored.valueTag,
      }),
      VALID_VERCEL_KEY,
    );
  });

  it('[ADMIN] lists only masked credentials, never the stored secrets', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.equal(res.body.data.length, 1);

    const credential = res.body.data[0];
    assert.equal(credential.provider, 'VERCEL');
    assert.ok(credential.maskedPreview);
    assert.ok(!('value' in credential));
    assert.ok(!('valueCiphertext' in credential));
    assert.ok(!('valueIv' in credential));
    assert.ok(!('valueTag' in credential));
  });

  it('[ADMIN] rejects a duplicated provider for the same project', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'VERCEL', value: VALID_VERCEL_KEY });

    assert.equal(res.status, 409);
  });

  it('[ADMIN] rotates a credential and refreshes maskedPreview/rotatedAt', async () => {
    const res = await request(app)
      .put(`/api/projects/${projectId}/credentials/VERCEL`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: VALID_VERCEL_KEY_2 });

    assert.equal(res.status, 200);
    assert.equal(res.body.maskedPreview, `••••${VALID_VERCEL_KEY_2.slice(-4)}`);
    assert.ok(res.body.rotatedAt);

    const stored = await prisma.providerCredential.findUnique({
      where: { id: res.body.id },
    });
    assert.ok(stored);
    assert.equal(
      decryptSecret({
        ciphertext: stored.valueCiphertext,
        iv: stored.valueIv,
        tag: stored.valueTag,
      }),
      VALID_VERCEL_KEY_2,
    );
  });

  it('[ADMIN] test with a valid-format key marks the credential as valid', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/credentials/VERCEL/test`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(!('error' in res.body));

    const stored = await prisma.providerCredential.findFirst({
      where: { projectId, provider: 'VERCEL' },
    });
    assert.equal(stored!.isValid, true);
  });

  it('[ADMIN] test with an invalid key marks the credential as invalid', async () => {
    // Valor con formato inválido → isValid false desde la creación.
    const created = await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'JENKINS', value: 'tiny' });

    assert.equal(created.status, 201);
    assert.equal(created.body.isValid, false);

    const res = await request(app)
      .post(`/api/projects/${projectId}/credentials/JENKINS/test`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error);

    const stored = await prisma.providerCredential.findFirst({
      where: { projectId, provider: 'JENKINS' },
    });
    assert.equal(stored!.isValid, false);
  });

  it('[ADMIN] deletes a credential', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/credentials/JENKINS`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 204);

    const stored = await prisma.providerCredential.findFirst({
      where: { projectId, provider: 'JENKINS' },
    });
    assert.equal(stored, null);
  });

  it('[ADMIN] returns 404 for a nonexistent project', async () => {
    const res = await request(app)
      .get('/api/projects/00000000-0000-4000-8000-000000000000/credentials')
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 404);
  });

  it('[ADMIN] returns 400 for an invalid provider', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'KUBERNETES', value: 'something-long-enough' });

    assert.equal(res.status, 400);
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get(`/api/projects/${projectId}/credentials`);
    assert.equal(res.status, 401);
  });

  it('rejects a DEVELOPER from managing credentials', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${devToken}`);

    assert.equal(res.status, 403);
  });
});
