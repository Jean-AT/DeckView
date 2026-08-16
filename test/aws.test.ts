import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ECSClient, type Deployment as EcsDeployment } from '@aws-sdk/client-ecs';
import { AwsEcsProvider } from '../src/providers/aws';
import type { AwsEcsClient } from '../src/providers/aws';
import { AuthError, ProviderError } from '../src/providers/types';
import { providerRegistry } from '../src/providers';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { syncService } from '../src/services/syncService';

const app = createApp();

const project = {
  provider: 'AWS',
  providerConfig: { region: 'us-east-1', cluster: 'prod-cluster', service: 'backend-api' },
} as never;

const validSecret = JSON.stringify({
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
});

function deployment(overrides: Partial<EcsDeployment> = {}): EcsDeployment {
  return {
    id: 'bec1bea4-c9ba-4c8a-9f7a-deadbeef0001',
    status: 'PRIMARY',
    rolloutState: 'COMPLETED',
    createdAt: new Date('2026-08-10T10:00:00Z'),
    updatedAt: new Date('2026-08-10T10:05:00Z'),
    taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/backend-api:12',
    desiredCount: 3,
    runningCount: 3,
    pendingCount: 0,
    failedTasks: 0,
    platformVersion: '1.4.0',
    ...overrides,
  };
}

function fakeClient(
  send: (command: unknown) => Promise<{ services: NonNullable<NonNullable<Awaited<ReturnType<AwsEcsClient['send']>>['services']>> }>,
): AwsEcsClient {
  return { send } as AwsEcsClient;
}

describe('AwsEcsProvider', () => {
  it('maps deployments to NormalizedDeployment with metadata', async () => {
    const provider = new AwsEcsProvider(
      fakeClient(async () => ({
        services: [
          {
            status: 'ACTIVE',
            runningCount: 5,
            desiredCount: 5,
            pendingCount: 0,
            deployments: [
              deployment(),
              deployment({
                id: 'dep-running',
                status: 'ACTIVE',
                rolloutState: 'IN_PROGRESS',
                runningCount: 1,
                pendingCount: 2,
              }),
              deployment({
                id: 'dep-failed',
                status: 'INACTIVE',
                rolloutState: 'FAILED',
                updatedAt: new Date('2026-08-10T11:00:00Z'),
              }),
            ],
          },
        ],
      })),
    );

    const result = await provider.fetchDeployments(project, validSecret);

    assert.equal(result.length, 3);
    assert.equal(result[0].status, 'SUCCESS');
    assert.deepEqual(result[0].finishedAt, new Date('2026-08-10T10:05:00Z'));
    assert.equal(result[1].status, 'RUNNING');
    assert.equal(result[1].finishedAt, undefined);
    assert.equal(result[2].status, 'FAILED');

    assert.equal(result[0].externalId, 'bec1bea4-c9ba-4c8a-9f7a-deadbeef0001');
    assert.equal(result[0].metadata?.rolloutState, 'COMPLETED');
    assert.equal(result[0].metadata?.desiredCount, 3);
    assert.equal(result[1].metadata?.pendingCount, 2);
    assert.equal(result[0].metadata?.serviceStatus, 'ACTIVE');
    assert.equal(
      result[0].url,
      'https://console.aws.amazon.com/ecs/v2/clusters/prod-cluster/services/backend-api?region=us-east-1',
    );
  });

  it('sends DescribeServicesCommand with cluster and service', async () => {
    let capturedInput: Record<string, unknown> | undefined;

    const provider = new AwsEcsProvider(
      fakeClient(async (command) => {
        capturedInput = (command as { input?: Record<string, unknown> }).input;
        return { services: [] };
      }),
    );

    await provider.fetchDeployments(project, validSecret);
    assert.deepEqual(capturedInput, { cluster: 'prod-cluster', services: ['backend-api'] });
  });

  it('maps auth errors to AuthError', async () => {
    for (const name of ['UnrecognizedClientException', 'ExpiredTokenException', 'AccessDeniedException']) {
      const provider = new AwsEcsProvider(
        fakeClient(async () => {
          throw { name };
        }),
      );
      await assert.rejects(() => provider.fetchDeployments(project, validSecret), AuthError);
    }
  });

  it('maps resource-not-found to ProviderError', async () => {
    const provider = new AwsEcsProvider(
      fakeClient(async () => {
        throw { name: 'ServiceNotFoundException' };
      }),
    );
    await assert.rejects(() => provider.fetchDeployments(project, validSecret), ProviderError);
  });

  it('maps unknown SDK errors to ProviderError', async () => {
    const provider = new AwsEcsProvider(
      fakeClient(async () => {
        throw { name: 'ThrottlingException', message: 'slow down' };
      }),
    );
    await assert.rejects(
      () => provider.fetchDeployments(project, validSecret),
      (err: unknown) => err instanceof ProviderError && err.message.includes('slow down'),
    );
  });

  it('throws ProviderError for malformed credentials', async () => {
    const provider = new AwsEcsProvider(fakeClient(async () => ({ services: [] })));

    await assert.rejects(
      () => provider.fetchDeployments(project, 'not-json'),
      (err: unknown) => err instanceof ProviderError && err.message.includes('JSON'),
    );
    await assert.rejects(
      () => provider.fetchDeployments(project, JSON.stringify({ secretAccessKey: 'onlysecret' })),
      ProviderError,
    );
  });

  it('throws ProviderError when config is incomplete', async () => {
    const provider = new AwsEcsProvider(fakeClient(async () => ({ services: [] })));

    await assert.rejects(
      () =>
        provider.fetchDeployments(
          { provider: 'AWS', providerConfig: { region: 'us-east-1' } } as never,
          validSecret,
        ),
      ProviderError,
    );
  });

  it('registry resolves AWS', () => {
    assert.equal(providerRegistry.get('AWS').name, 'AWS');
  });
});

describe('AWS credential format validation', () => {
  let adminToken: string;
  let projectId: string;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await request(app).post('/api/auth/register').send({
      name: 'AWS Admin',
      email: 'aws-admin@test.dev',
      password: 'supersecret123',
    });

    const login = await request(app).post('/api/auth/login').send({
      email: 'aws-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = login.body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'AWS Project',
        provider: 'AWS',
        providerConfig: { region: 'us-east-1', cluster: 'prod-cluster', service: 'backend-api' },
      });
    projectId = project.body.id;
  });

  it('accepts a well-formed AWS credential', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'AWS', value: validSecret });

    assert.equal(res.status, 201);
  });

  it('rejects a bad access key id', async () => {
    const otherProject = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'AWS Project Bad Key',
        provider: 'AWS',
        providerConfig: { region: 'us-east-1', cluster: 'c', service: 's' },
      });

    const res = await request(app)
      .post(`/api/projects/${otherProject.body.id}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        provider: 'AWS',
        value: JSON.stringify({
          accessKeyId: 'BADKEY',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        }),
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.isValid, false);
  });
});

describe('AWS sync end-to-end', () => {
  let adminToken: string;
  let projectId: string;
  let originalSend: typeof ECSClient.prototype.send;

  before(async () => {
    await prisma.ticket.deleteMany();
    await prisma.deployment.deleteMany();
    await prisma.providerCredential.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    await request(app).post('/api/auth/register').send({
      name: 'AWS Sync Admin',
      email: 'aws-sync-admin@test.dev',
      password: 'supersecret123',
    });

    const login = await request(app).post('/api/auth/login').send({
      email: 'aws-sync-admin@test.dev',
      password: 'supersecret123',
    });
    adminToken = login.body.accessToken;

    const project = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'AWS Sync Project',
        provider: 'AWS',
        providerConfig: { region: 'eu-west-1', cluster: 'staging', service: 'web' },
      });
    projectId = project.body.id;

    await request(app)
      .post(`/api/projects/${projectId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ provider: 'AWS', value: validSecret });
  });

  it('syncs ECS deployments through the registry and persists metadata', async () => {
    originalSend = ECSClient.prototype.send;
    (ECSClient.prototype.send as unknown) = async () => ({
      services: [{ deployments: [deployment({ id: 'ecs-abc123' })] }],
    });

    try {
      const result = await syncService.syncProject(projectId);
      assert.equal(result.status, 'ok');
      assert.equal(result.count, 1);

      const row = await prisma.deployment.findFirst({ where: { projectId } });
      assert.equal(row!.externalId, 'ecs-abc123');
      assert.equal(row!.status, 'SUCCESS');
      assert.equal(row!.provider, 'AWS');
      assert.equal((row!.metadata as { desiredCount?: number }).desiredCount, 3);
      assert.equal(
        (row!.metadata as { taskDefinition?: string }).taskDefinition,
        'arn:aws:ecs:us-east-1:123456789012:task-definition/backend-api:12',
      );
      assert.equal(row!.durationMs, 300000);
    } finally {
      ECSClient.prototype.send = originalSend;
    }
  });
});
