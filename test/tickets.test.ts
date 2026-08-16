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

describe('tickets API', () => {
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

    adminToken = await registerAndLogin('Ticket Admin', 'ticket-admin@test.dev');

    for (const [name, email, role] of [
      ['Ticket Dev', 'ticket-dev@test.dev', 'DEVELOPER'],
      ['Ticket Viewer', 'ticket-viewer@test.dev', 'VIEWER'],
    ]) {
      await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name, email, password: 'supersecret123', role });
    }

    devToken = (
      await request(app).post('/api/auth/login').send({
        email: 'ticket-dev@test.dev',
        password: 'supersecret123',
      })
    ).body.accessToken;

    viewerToken = (
      await request(app).post('/api/auth/login').send({
        email: 'ticket-viewer@test.dev',
        password: 'supersecret123',
      })
    ).body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Tickets Project',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'tickets' },
      });
    projectId = project.body.id;
  });

  it('creates a ticket with defaults', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId, title: 'Incidente de red' });

    assert.equal(res.status, 201);
    assert.equal(res.body.priority, 'MEDIUM');
    assert.equal(res.body.status, 'OPEN');
    assert.equal(res.body.assignedTo, null);
    assert.equal(res.body.project.name, 'Tickets Project');
  });

  it('creates a ticket with explicit fields', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${devToken}`)
      .send({
        projectId,
        title: '502 en la API',
        description: 'Error al desplegar el servicio',
        priority: 'CRITICAL',
        assignedTo: 'Jean',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.priority, 'CRITICAL');
    assert.equal(res.body.assignedTo, 'Jean');
    assert.equal(res.body.description, 'Error al desplegar el servicio');
  });

  it('rejects creating a ticket for a non-existent project', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId: '00000000-0000-0000-0000-000000000000', title: 'No project' });

    assert.equal(res.status, 404);
  });

  it('rejects creating a ticket as VIEWER', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ projectId, title: 'Forbidden' });

    assert.equal(res.status, 403);
  });

  it('lists tickets and filters by priority', async () => {
    const res = await request(app)
      .get('/api/tickets?priority=CRITICAL')
      .set('Authorization', `Bearer ${viewerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.data[0].priority, 'CRITICAL');
    assert.equal(res.body.data[0].projectId, projectId);
  });

  it('gets a ticket by id', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId, title: 'Para detalle' });

    const res = await request(app)
      .get(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.title, 'Para detalle');
  });

  it('updates status and priority', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId, title: 'Para update', priority: 'LOW' });

    const res = await request(app)
      .patch(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${devToken}`)
      .send({ status: 'IN_PROGRESS', priority: 'HIGH' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'IN_PROGRESS');
    assert.equal(res.body.priority, 'HIGH');
  });

  it('rejects an empty update', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId, title: 'Para empty update' });

    const res = await request(app)
      .patch(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    assert.equal(res.status, 400);
  });

  it('rejects update as VIEWER', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId, title: 'Para update viewer' });

    const res = await request(app)
      .patch(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ status: 'RESOLVED' });

    assert.equal(res.status, 403);
  });

  it('deletes a ticket as ADMIN', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId, title: 'Para borrar' });

    const res = await request(app)
      .delete(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    assert.equal(res.status, 204);
  });

  it('rejects delete as DEVELOPER', async () => {
    const created = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ projectId, title: 'Para borrar dev' });

    const res = await request(app)
      .delete(`/api/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${devToken}`);

    assert.equal(res.status, 403);
  });
});

describe('auto-creation of tickets on failed deployments', () => {
  let adminToken: string;
  let failedProjectId: string;
  let okProjectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    adminToken = await registerAndLogin('Auto Ticket Admin', 'autoticket@test.dev');

    const failedProject = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Auto Fail Project',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'auto-fail' },
      });
    failedProjectId = failedProject.body.id;

    const okProject = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Auto Ok Project',
        provider: 'JENKINS',
        providerConfig: { jenkinsUrl: 'http://jenkins:8080', jobName: 'auto-ok' },
      });
    okProjectId = okProject.body.id;

    await request(app)
      .post(`/api/projects/${failedProjectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'JENKINS', value: 'user:apitoken12345' });

    await request(app)
      .post(`/api/projects/${okProjectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'JENKINS', value: 'user:apitoken12345' });
  });

  function failedBuilds() {
    return jsonResponse({
      builds: [
        {
          number: 99,
          result: 'FAILURE',
          timestamp: 1723122000000,
          duration: 30000,
          url: 'http://jenkins:8080/job/auto-fail/99/',
          building: false,
        },
      ],
    });
  }

  it('creates a HIGH ticket when a deployment fails', async () => {
    globalThis.fetch = async () => failedBuilds();

    const result = await syncService.syncProject(failedProjectId);
    assert.equal(result.status, 'ok');

    const ticket = await prisma.ticket.findFirst({
      where: { projectId: failedProjectId },
    });

    assert.ok(ticket);
    assert.equal(ticket!.priority, 'HIGH');
    assert.equal(ticket!.status, 'OPEN');
    assert.match(ticket!.title, /Deploy fallido: Auto Fail Project/);
    assert.ok(ticket!.deploymentId);

    const deployment = await prisma.deployment.findFirst({
      where: { projectId: failedProjectId },
    });
    assert.equal(ticket!.deploymentId, deployment!.id);
  });

  it('does not create a duplicate ticket on re-sync', async () => {
    globalThis.fetch = async () => failedBuilds();

    await syncService.syncProject(failedProjectId);

    const count = await prisma.ticket.count({ where: { projectId: failedProjectId } });
    assert.equal(count, 1);
  });

  it('does not create a ticket for successful deployments', async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        builds: [
          {
            number: 1,
            result: 'SUCCESS',
            timestamp: 1723122000000,
            duration: 60000,
            url: 'http://jenkins:8080/job/auto-ok/1/',
            building: false,
          },
        ],
      });

    const result = await syncService.syncProject(okProjectId);
    assert.equal(result.status, 'ok');

    const count = await prisma.ticket.count({ where: { projectId: okProjectId } });
    assert.equal(count, 0);
  });
});
