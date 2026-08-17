import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { env } from '../src/config/env';

const app = createApp();
const SECRET = env.WEBHOOK_SECRET;

describe('webhooks API', () => {
  let adminToken: string;
  let vercelProjectId: string;
  let jenkinsProjectId: string;

  before(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await request(app).post('/api/auth/register').send({
      name: 'Webhook Admin',
      email: 'webhook-admin@test.dev',
      password: 'supersecret123',
    });
    const login = await request(app).post('/api/auth/login').send({
      email: 'webhook-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = login.body.accessToken;

    const vercel = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Webhook Vercel', provider: 'VERCEL', providerConfig: { vercelProjectId: 'prj_webhook' } });
    vercelProjectId = vercel.body.id;

    const jenkins = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Webhook Jenkins',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'webhook-job' },
      });
    jenkinsProjectId = jenkins.body.id;
  });

  it('rejects requests without the webhook secret', async () => {
    const res = await request(app)
      .post('/api/webhooks/vercel')
      .send({ type: 'deployment.ready', payload: { uid: 'dpl_unauth' } });
    assert.equal(res.status, 401);
  });

  it('rejects requests with a wrong webhook secret', async () => {
    const res = await request(app)
      .post('/api/webhooks/jenkins')
      .set('x-webhook-secret', 'wrong-secret-00000000000000')
      .send({});
    assert.equal(res.status, 401);
  });

  it('ingests a Vercel deployment event and persists it', async () => {
    const res = await request(app)
      .post('/api/webhooks/vercel')
      .set('x-webhook-secret', SECRET)
      .send({
        type: 'deployment.ready',
        payload: {
          uid: 'dpl_wh1',
          url: 'dpl-wh1.vercel.app',
          readyState: 'READY',
          createdAt: Date.now() - 5000,
          ready: Date.now(),
          meta: { githubCommitSha: 'aaa111' },
          projectId: 'prj_webhook',
        },
      });

    assert.equal(res.status, 202);
    assert.equal(res.body.status, 'ok');

    const deployment = await prisma.deployment.findFirst({
      where: { projectId: vercelProjectId, externalId: 'dpl_wh1' },
    });
    assert.ok(deployment);
    assert.equal(deployment!.status, 'SUCCESS');
    assert.equal(deployment!.commitSha, 'aaa111');
  });

  it('creates a HIGH/OPEN ticket when a Vercel event reports failure', async () => {
    const res = await request(app)
      .post('/api/webhooks/vercel')
      .set('x-webhook-secret', SECRET)
      .send({
        type: 'deployment.error',
        payload: {
          uid: 'dpl_whfail',
          readyState: 'ERROR',
          createdAt: Date.now() - 4000,
          projectId: 'prj_webhook',
        },
      });

    assert.equal(res.status, 202);

    const deployment = await prisma.deployment.findFirst({
      where: { projectId: vercelProjectId, externalId: 'dpl_whfail' },
    });
    assert.ok(deployment);
    assert.equal(deployment!.status, 'FAILED');

    const ticket = await prisma.ticket.findFirst({
      where: { deploymentId: deployment!.id },
    });
    assert.ok(ticket);
    assert.equal(ticket!.status, 'OPEN');
    assert.equal(ticket!.priority, 'HIGH');
  });

  it('ingests a Jenkins build event matched by job name', async () => {
    const res = await request(app)
      .post('/api/webhooks/jenkins')
      .set('x-webhook-secret', SECRET)
      .send({
        project: { name: 'webhook-job' },
        build: {
          number: 42,
          url: 'http://jenkins:8080/job/webhook-job/42/',
          status: 'SUCCESS',
          timestamp: 1000,
          scm: { commit: 'bbb222' },
        },
      });

    assert.equal(res.status, 202);

    const deployment = await prisma.deployment.findFirst({
      where: { projectId: jenkinsProjectId, externalId: '42' },
    });
    assert.ok(deployment);
    assert.equal(deployment!.status, 'SUCCESS');
    assert.equal(deployment!.commitSha, 'bbb222');
  });

  it('maps Jenkins failures to tickets', async () => {
    const res = await request(app)
      .post('/api/webhooks/jenkins')
      .set('x-webhook-secret', SECRET)
      .send({
        project: { name: 'webhook-job' },
        build: { number: 43, status: 'FAILURE', timestamp: 1500 },
      });

    assert.equal(res.status, 202);

    const deployment = await prisma.deployment.findFirst({
      where: { projectId: jenkinsProjectId, externalId: '43' },
    });
    assert.equal(deployment!.status, 'FAILED');

    const ticket = await prisma.ticket.findFirst({ where: { deploymentId: deployment!.id } });
    assert.ok(ticket);
  });

  it('returns 404 when no project matches the webhook payload', async () => {
    const res = await request(app)
      .post('/api/webhooks/vercel')
      .set('x-webhook-secret', SECRET)
      .send({
        type: 'deployment.ready',
        payload: { uid: 'dpl_unknown', readyState: 'READY', projectId: 'prj_nope' },
      });

    assert.equal(res.status, 404);
  });
});