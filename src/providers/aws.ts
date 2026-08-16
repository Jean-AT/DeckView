import {
  ECSClient,
  DescribeServicesCommand,
  type Deployment as EcsDeployment,
  type Service,
} from '@aws-sdk/client-ecs';
import type { Project } from '@prisma/client';
import type { NormalizedDeployment } from './types';
import { AuthError, ProviderError } from './types';

interface AwsConfig {
  region?: unknown;
  cluster?: unknown;
  service?: unknown;
}

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

type AwsError = { name?: string; message?: string };

const AUTH_ERROR_NAMES = new Set([
  'UnrecognizedClientException',
  'InvalidClientTokenIdException',
  'InvalidSignatureException',
  'ExpiredTokenException',
  'AccessDeniedException',
]);

const NOT_FOUND_ERROR_NAMES = new Set([
  'ServiceNotFoundException',
  'ClusterNotFoundException',
]);

export interface AwsEcsClient {
  send(command: unknown): Promise<{ services?: Service[] }>;
}

function getConfig(project: Project): { region: string; cluster: string; service: string } {
  const config = (project.providerConfig ?? {}) as AwsConfig;

  for (const field of ['region', 'cluster', 'service'] as const) {
    if (typeof config[field] !== 'string') {
      throw new ProviderError(
        `providerConfig must include "${field}" for AWS (region, cluster, service)`,
      );
    }
  }

  return config as { region: string; cluster: string; service: string };
}

function parseCredentials(secret: string): AwsCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new ProviderError(
      'AWS credential must be JSON: {"accessKeyId":"...","secretAccessKey":"...","sessionToken":"(opcional)"}',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError('AWS credential must be a JSON object');
  }

  const { accessKeyId, secretAccessKey, sessionToken } = parsed as Record<string, unknown>;

  if (
    typeof accessKeyId !== 'string' ||
    typeof secretAccessKey !== 'string' ||
    (sessionToken !== undefined && typeof sessionToken !== 'string')
  ) {
    throw new ProviderError(
      'AWS credential must include string accessKeyId and secretAccessKey (sessionToken opcional)',
    );
  }

  return { accessKeyId, secretAccessKey, sessionToken };
}

function mapStatus(deployment: EcsDeployment): NormalizedDeployment['status'] {
  switch (deployment.rolloutState) {
    case 'IN_PROGRESS':
      return 'RUNNING';
    case 'FAILED':
      return 'FAILED';
    case 'COMPLETED':
      return 'SUCCESS';
    default:
      break;
  }

  switch (deployment.status) {
    case 'PRIMARY':
      return 'SUCCESS';
    case 'ACTIVE':
      return 'RUNNING';
    case 'INACTIVE':
      return 'SUCCESS';
    default:
      return 'RUNNING';
  }
}

function mapDeployment(
  deployment: EcsDeployment,
  service: Service | undefined,
  serviceUrl: string,
): NormalizedDeployment {
  const rolloutFinished =
    deployment.rolloutState === 'COMPLETED' || deployment.rolloutState === 'FAILED';

  return {
    externalId: deployment.id as string,
    status: mapStatus(deployment),
    url: serviceUrl,
    startedAt: deployment.createdAt ?? new Date(),
    finishedAt: rolloutFinished ? (deployment.updatedAt ?? undefined) : undefined,
    metadata: {
      status: deployment.status,
      rolloutState: deployment.rolloutState,
      rolloutStateReason: deployment.rolloutStateReason,
      desiredCount: deployment.desiredCount,
      pendingCount: deployment.pendingCount,
      runningCount: deployment.runningCount,
      failedTasks: deployment.failedTasks,
      taskDefinition: deployment.taskDefinition,
      platformVersion: deployment.platformVersion,
      serviceStatus: service?.status,
      serviceRunningCount: service?.runningCount,
      serviceDesiredCount: service?.desiredCount,
      servicePendingCount: service?.pendingCount,
    },
  };
}

export class AwsEcsProvider {
  name = 'AWS' as const;

  // Cliente inyectable para tests; por defecto usa el SDK real.
  constructor(private readonly client?: AwsEcsClient) {}

  private getClient(region: string, credentials: AwsCredentials): AwsEcsClient {
    if (this.client) return this.client;

    return new ECSClient({
      region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
      },
    }) as AwsEcsClient;
  }

  async fetchDeployments(project: Project, secret: string): Promise<NormalizedDeployment[]> {
    const config = getConfig(project);
    const credentials = parseCredentials(secret);

    const client = this.getClient(config.region, credentials);

    const serviceUrl =
      `https://console.aws.amazon.com/ecs/v2/clusters/` +
      `${encodeURIComponent(config.cluster)}/services/${encodeURIComponent(config.service)}` +
      `?region=${encodeURIComponent(config.region)}`;

    try {
      const { services } = await client.send(
        new DescribeServicesCommand({
          cluster: config.cluster,
          services: [config.service],
        }),
      );

      const service = services?.[0];
      const deployments = service?.deployments ?? [];

      return deployments
        .filter((d) => d.id)
        .map((d) => mapDeployment(d, service, serviceUrl));
    } catch (err) {
      const awsError = err as AwsError;
      const name = awsError.name ?? 'UnknownError';

      if (AUTH_ERROR_NAMES.has(name)) {
        throw new AuthError(`AWS rejected the credentials (${name})`);
      }

      if (NOT_FOUND_ERROR_NAMES.has(name)) {
        throw new ProviderError(
          `AWS ECS resource not found (${name}). Check providerConfig cluster/service.`,
        );
      }

      throw new ProviderError(
        `AWS ECS API error (${name}${awsError.message ? `: ${awsError.message}` : ''})`,
      );
    }
  }
}
