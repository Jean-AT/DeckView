import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '@prisma/client';
import type { DeploymentProvider } from '../src/providers';
import { FirebaseHostingProvider } from '../src/providers/firebase';
import { AuthError, ProviderError } from '../src/providers';

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDmXNJsVCMtKmAB
7Ii67lPXQNpRKHpWq2tppr1hKyYDMCtSdaMhEezThnio0pEoux+ZGKiihZib51LX
tU7hLJbumX5JNH3MnnSPrsXyDudIhQFM+3OId1VCBUQi+68LwcFAisEFxCnF4Aie
opNQWLmzD3iTpEUWBHRunQ0jFPU73AZdUVlNkZNe0b+dybqIyzwLni0JaF+I6ypn
1PLsGiISdxrGvPR6+RQZoDde/igulqcGJYmeOk8qXwkZgwyQzaVZ1iBb8HPON+zK
ic49LCAu/SzUL9xzNyLu9kgWUtfdiEc+WU3xf97F7V5qViNmtNvii3ciZNz2vevy
G+l6A+5lAgMBAAECggEAAduj9yuK42weUp2mW6ryQlVGUtW//i917L1OH+NsdCWh
D9JIPXXKzR5I8672bJeXxrvAGRwj5zargHcN+rsfQNo8Pm8TMwGLK0vWUmBkOqhB
+ALmLhFXqXI9QrKjeTWNRLiUcSK20ImroCCWY2qXyCswMTFSZ6ijtMRaV7BYAFfU
dJNxi7lmx378TrV9WrJLCZAOs8mlcZeAneDHvvLdW7X18dvV9wpalQIaKBVF2Q2z
1JeM0YINKqVuaVU82f05qnoKaCLmK5YsqiyZC2NvpN5gZ2hIGmB2viRvnupIGRRJ
7SeCiOlWPcZaOnWwPMyAQvLbvPolDSiHdE/NghBnaQKBgQD9WukYrXqe/oTdtkRN
SWJRcWT18rkzZlbowPbElMdUs7Q+ZGbL9zEmiCxOnMHYri4puxp3MkWEc2+EiJQi
SPs0wgDQWcem5PgAQgqN8SSpMWofGvNIEYFD8px0Yj6VoR4MPYEbwKec+dXcxIk9
dRkJmMOB+jsRi9SdiEMYS/e/GQKBgQDoxHbNuLGw54mjSxsCNHtUAqsP2oA+TXeK
ZagUZnHuoVIkbrZMk0k4gHPzUusFCrIUnprV2rmpUoOmQmb51ISsOi4UOykD4zsK
MKDiwBzCRlUhmrc6Gf/pwCtJQwoKm3nYy8Moa+mT9JE6oBG8lN5DpFR6vuG9OcuW
aTz0mWfvLQKBgFjnDsZ3EYE7RLpcHAmWx6ZWiRv46V4M+lBAbhc7MdsaGBSQvLWz
7w5bWFjZjvgO3uoL2tSa0mQQ8b/rATgqreOsdAaoinOZAyFsCzIVvUyVp2x004ul
gNusBZSdaOKun9Ghv21SpD5kONR4LsRfE8MXVPuGKDYXACurRgf/mFb5AoGBAMD9
C0d754+2GQ8TmVwVqV85Kx1k20lMr11G9bmcSsBAbruYM3t/7ohzMC/BQuyWNpoT
+mpvA9pYeKCjk3917V5iiovplRMNFolXUj1ObUnCSJkpDtuUbPMgioMemze6Oqc+
IhvkhPBQKQ1DZBFIGJRarlRq6P0b6ylVLd3bRyotAoGAZzTEuTVNF0JdSjXYd0vI
EkWPikAfRD0QIbkWeC/LzVzOuLG/WW7MJKkM0mRFdQ4aFCSV28d6WBzabYySp2Ah
o6Yobv26CtL+1+j7+Mk9R/GomyueRrOLkK9BI5TbnycvWEFQl8DKl5QpqZMkY8EN
DK/2LZSAwUAxKWVp9yxGLvM=
-----END PRIVATE KEY-----
`;

const SERVICE_ACCOUNT = {
  client_email: 'deploy@devops-dashboard.iam.gserviceaccount.com',
  private_key: PRIVATE_KEY,
  project_id: 'devops-dashboard-prod',
};

const project = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Firebase Site',
  provider: 'FIREBASE',
  providerConfig: { firebaseSiteId: 'my-site', firebaseProjectId: 'devops-dashboard-prod' },
} as unknown as Project;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('FirebaseHostingProvider', () => {
  let originalFetch: typeof fetch;

  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('exchanges the service account for a token and lists releases', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'ya29.fake', expires_in: 3600 });
      }
      if (url.includes('/releases')) {
        return jsonResponse({
          releases: [
            {
              name: 'projects/devops-dashboard-prod/sites/my-site/releases/r1',
              type: 'DEPLOY',
              releaseTime: '2026-08-16T10:00:00Z',
              version: {
                versionId: 'v1',
                status: 'DEPLOYED',
                createTime: '2026-08-16T09:59:00Z',
                finalizeTime: '2026-08-16T10:00:00Z',
                commit: { commitSha: 'abc123' },
              },
            },
            {
              name: 'projects/devops-dashboard-prod/sites/my-site/releases/r2',
              type: 'DEPLOY',
              releaseTime: '2026-08-16T11:00:00Z',
              version: { versionId: 'v2', status: 'FAILED', createTime: '2026-08-16T10:59:00Z' },
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const provider = new FirebaseHostingProvider();
    const deployments = await provider.fetchDeployments(project, JSON.stringify(SERVICE_ACCOUNT));

    assert.equal(deployments.length, 2);

    const deployed = deployments.find((d) => d.externalId === 'v1')!;
    assert.equal(deployed.status, 'SUCCESS');
    assert.equal(deployed.commitSha, 'abc123');
    assert.equal(deployed.url, 'https://my-site.web.app');

    const failed = deployments.find((d) => d.externalId === 'v2')!;
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.url, undefined);
  });

  it('reuses the cached token within the expiry window', async () => {
    let tokenCalls = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        tokenCalls += 1;
        return jsonResponse({ access_token: 'ya29.cached', expires_in: 3600 });
      }
      if (url.includes('/releases')) {
        return jsonResponse({ releases: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const provider = new FirebaseHostingProvider();
    await provider.fetchDeployments(project, JSON.stringify(SERVICE_ACCOUNT));
    await provider.fetchDeployments(project, JSON.stringify(SERVICE_ACCOUNT));

    assert.equal(tokenCalls, 1);
  });

  it('requires firebaseSiteId in providerConfig', async () => {
    globalThis.fetch = async () => jsonResponse({ releases: [] });

    const noSite = { ...project, providerConfig: {} } as unknown as Project;
    const provider = new FirebaseHostingProvider();

    await assert.rejects(
      () => provider.fetchDeployments(noSite, JSON.stringify(SERVICE_ACCOUNT)),
      ProviderError,
    );
  });

  it('throws AuthError when the releases API rejects the token', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 'ya29.denied', expires_in: 3600 });
      }
      return new Response('Forbidden', { status: 403 });
    };

    const provider = new FirebaseHostingProvider();
    await assert.rejects(
      () => provider.fetchDeployments(project, JSON.stringify(SERVICE_ACCOUNT)),
      AuthError,
    );
  });

  it('throws AuthError when the token exchange fails', async () => {
    globalThis.fetch = async () => new Response('Bad Request', { status: 400 });

    const provider = new FirebaseHostingProvider();
    await assert.rejects(
      () => provider.fetchDeployments(project, JSON.stringify(SERVICE_ACCOUNT)),
      AuthError,
    );
  });

  it('rejects credentials that are not valid service accounts', async () => {
    const provider = new FirebaseHostingProvider();
    await assert.rejects(() => provider.fetchDeployments(project, 'not-json'), ProviderError);
    await assert.rejects(
      () => provider.fetchDeployments(project, JSON.stringify({ foo: 'bar' })),
      ProviderError,
    );
  });

  it('has no triggerDeploy (Firebase deploys are not triggerable via API)', () => {
    const provider: DeploymentProvider = new FirebaseHostingProvider();
    assert.equal(provider.triggerDeploy, undefined);
  });
});