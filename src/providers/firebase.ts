import jwt from 'jsonwebtoken';
import type { Project } from '@prisma/client';
import type { DeploymentProvider, NormalizedDeployment } from './types';
import { AuthError, ProviderError } from './types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIREBASE_API = 'https://firebase.googleapis.com/v1beta1';
const FIREBASE_SCOPE = 'https://www.googleapis.com/auth/firebase';

interface FirebaseServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface FirebaseRelease {
  name: string;
  type?: string;
  releaseTime?: string;
  version?: {
    versionId?: string;
    status?: string;
    createTime?: string;
    finalizeTime?: string;
    commit?: { commitSha?: string };
  };
}

function parseServiceAccount(secret: string): FirebaseServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new ProviderError('Firebase credential must be a JSON service account');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError('Firebase credential must be a JSON service account');
  }

  const { client_email, private_key, project_id } = parsed as Record<string, unknown>;

  if (typeof client_email !== 'string' || typeof private_key !== 'string' || typeof project_id !== 'string') {
    throw new ProviderError('Firebase credential missing client_email, private_key or project_id');
  }

  return {
    client_email,
    // Los service accounts de Google escapan los saltos de línea como \\n.
    private_key: private_key.replace(/\\n/g, '\n'),
    project_id,
  };
}

function mapStatus(status?: string): NormalizedDeployment['status'] {
  switch (status) {
    case 'DEPLOYED':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    case 'ABANDONED':
      return 'CANCELLED';
    default:
      // CREATED, FINALIZED, EXPIRED, ... → en curso o sin clasificar
      return 'RUNNING';
  }
}

export class FirebaseHostingProvider implements DeploymentProvider {
  name = 'FIREBASE' as const;

  private accessToken?: string;
  private tokenExpiresAt = 0;

  async fetchDeployments(project: Project, secret: string): Promise<NormalizedDeployment[]> {
    const config = (project.providerConfig ?? {}) as { firebaseSiteId?: unknown; firebaseProjectId?: unknown };
    const siteId = typeof config.firebaseSiteId === 'string' ? config.firebaseSiteId : undefined;

    if (!siteId) {
      throw new ProviderError('Firebase providerConfig is missing firebaseSiteId');
    }

    const serviceAccount = parseServiceAccount(secret);
    const projectId =
      typeof config.firebaseProjectId === 'string' && config.firebaseProjectId
        ? config.firebaseProjectId
        : serviceAccount.project_id;

    const accessToken = await this.getAccessToken(serviceAccount);

    const url = new URL(
      `${FIREBASE_API}/projects/${projectId}/sites/${siteId}/releases`,
    );
    url.searchParams.set('pageSize', '30');

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`Firebase rejected the token (HTTP ${res.status})`);
      }
      throw new ProviderError(`Firebase API error (HTTP ${res.status})`);
    }

    const body = (await res.json()) as { releases?: FirebaseRelease[] };

    return (body.releases ?? [])
      .filter((release) => release.version)
      .map((release) => this.mapRelease(release, siteId, projectId));
  }

  private mapRelease(
    release: FirebaseRelease,
    siteId: string,
    projectId: string,
  ): NormalizedDeployment {
    const version = release.version!;
    const externalId = version.versionId ?? release.name.split('/').pop() ?? release.name;
    const status = mapStatus(version.status);

    return {
      externalId,
      status,
      commitSha: version.commit?.commitSha,
      url: status === 'SUCCESS' ? `https://${siteId}.web.app` : undefined,
      startedAt: version.createTime ? new Date(version.createTime) : new Date(release.releaseTime ?? Date.now()),
      finishedAt: version.finalizeTime ? new Date(version.finalizeTime) : undefined,
      metadata: {
        releaseType: release.type ?? null,
        siteId,
        projectId,
      },
    };
  }

  private async getAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && now < this.tokenExpiresAt - 60) {
      return this.accessToken;
    }

    const assertion = jwt.sign(
      {
        iss: serviceAccount.client_email,
        scope: FIREBASE_SCOPE,
        aud: TOKEN_URL,
        iat: now,
      },
      serviceAccount.private_key,
      { algorithm: 'RS256', expiresIn: 3600 },
    );

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      throw new AuthError(`Firebase token exchange failed (HTTP ${res.status})`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof data.access_token !== 'string') {
      throw new AuthError('Firebase token exchange returned no access token');
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + (data.expires_in ?? 3600);

    return this.accessToken;
  }
}