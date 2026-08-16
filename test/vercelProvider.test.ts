import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { VercelProvider } from '../src/providers/vercel';
import { AuthError, ProviderError } from '../src/providers/types';

const provider = new VercelProvider();
const project = {
  provider: 'VERCEL',
  providerConfig: { vercelProjectId: 'prj_demo' },
} as never;

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

describe('VercelProvider', () => {
  it('maps Vercel deployments to NormalizedDeployment', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.ok(url.includes('projectId=prj_demo'));

      return jsonResponse({
        deployments: [
          {
            uid: 'dpl_1',
            url: 'app.vercel.app',
            state: 'READY',
            createdAt: 1000,
            ready: 2000,
            meta: { githubCommitSha: 'abc123' },
          },
          { uid: 'dpl_2', state: 'ERROR', createdAt: 3000 },
          { uid: 'dpl_3', state: 'BUILDING', createdAt: 4000 },
        ],
      });
    };

    const result = await provider.fetchDeployments(project, 'vercel_token');

    assert.equal(result.length, 3);
    assert.deepEqual(result[0], {
      externalId: 'dpl_1',
      status: 'SUCCESS',
      commitSha: 'abc123',
      url: 'https://app.vercel.app',
      startedAt: new Date(1000),
      finishedAt: new Date(2000),
    });
    assert.equal(result[1].status, 'FAILED');
    assert.equal(result[2].status, 'RUNNING');
  });

  it('sends the token as a Bearer Authorization header', async () => {
    let seenAuthorization: string | undefined;

    globalThis.fetch = async (_input, init) => {
      seenAuthorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return jsonResponse({ deployments: [] });
    };

    await provider.fetchDeployments(project, 'secret-token-123');
    assert.equal(seenAuthorization, 'Bearer secret-token-123');
  });

  it('skips the projectId filter when providerConfig has none', async () => {
    let seenUrl = '';

    globalThis.fetch = async (input) => {
      seenUrl = String(input);
      return jsonResponse({ deployments: [] });
    };

    await provider.fetchDeployments({ provider: 'VERCEL', providerConfig: null } as never, 'tok');
    assert.ok(!seenUrl.includes('projectId='));
  });

  it('throws AuthError on 401 so the credential can be marked invalid', async () => {
    globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });

    await assert.rejects(() => provider.fetchDeployments(project, 'bad'), AuthError);
  });

  it('throws ProviderError on other HTTP errors', async () => {
    globalThis.fetch = async () => new Response('Server error', { status: 500 });

    await assert.rejects(() => provider.fetchDeployments(project, 'tok'), ProviderError);
  });
});
