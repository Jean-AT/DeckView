import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { testCredential } from '../src/services/credentialTest';

const FIREBASE_SA = JSON.stringify({
  client_email: 'deploy@devops.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----\n',
  project_id: 'devops-dashboard',
});

describe('testCredential', () => {
  it('accepts valid Vercel keys', () => {
    assert.deepEqual(testCredential('VERCEL', 'vercel_abc123def456'), { ok: true });
  });

  it('rejects Vercel keys with the wrong prefix', () => {
    assert.deepEqual(testCredential('VERCEL', 'ghp_wrongprefix'), {
      ok: false,
      error: 'Invalid VERCEL key format',
    });
  });

  it('accepts GitHub PAT prefixes', () => {
    for (const key of ['ghp_abcdefghij', 'gho_abcdefghij', 'github_pat_abcdefghij']) {
      assert.deepEqual(testCredential('GITHUB_ACTIONS', key), { ok: true });
    }
  });

  it('rejects keys without a known GitHub prefix', () => {
    assert.deepEqual(testCredential('GITHUB_ACTIONS', 'azure_abcdefghij'), {
      ok: false,
      error: 'Invalid GITHUB_ACTIONS key format',
    });
  });

  it('accepts any sufficiently long key for formatless providers', () => {
    assert.deepEqual(testCredential('JENKINS', 'user:apitoken'), { ok: true });
  });

  it('rejects keys shorter than 10 chars', () => {
    assert.deepEqual(testCredential('JENKINS', 'short'), { ok: false, error: 'Key too short' });
  });

  it('accepts well-formed AWS credentials', () => {
    const value = JSON.stringify({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    assert.deepEqual(testCredential('AWS', value), { ok: true });
  });

  it('accepts AWS credentials with a session token', () => {
    const value = JSON.stringify({
      accessKeyId: 'ASIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      sessionToken: 'FwoGZXIvYXdzEBwaDJ4example',
    });
    assert.deepEqual(testCredential('AWS', value), { ok: true });
  });

  it('rejects AWS credentials that are not valid JSON', () => {
    assert.deepEqual(testCredential('AWS', 'not-json'), {
      ok: false,
      error: 'AWS credential must be a JSON object',
    });
  });

  it('rejects AWS credentials that are not objects', () => {
    for (const value of ['"AKIA"', '42', '["AKIA","secret"]']) {
      assert.deepEqual(testCredential('AWS', value), {
        ok: false,
        error: 'AWS credential must be a JSON object',
      });
    }
  });

  it('rejects AWS access key ids not starting with AKIA/ASIA', () => {
    assert.deepEqual(
      testCredential(
        'AWS',
        JSON.stringify({
          accessKeyId: 'BADKEY',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        }),
      ),
      { ok: false, error: 'Invalid AWS access key id (must start with AKIA or ASIA)' },
    );
  });

  it('rejects AWS secret access keys shorter than 16 chars', () => {
    assert.deepEqual(
      testCredential(
        'AWS',
        JSON.stringify({ accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'short' }),
      ),
      { ok: false, error: 'Invalid AWS secret access key' },
    );
  });

  it('rejects AWS session tokens of the wrong type', () => {
    assert.deepEqual(
      testCredential(
        'AWS',
        JSON.stringify({
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          sessionToken: 123,
        }),
      ),
      { ok: false, error: 'AWS sessionToken must be a string' },
    );
  });

  it('accepts a valid Firebase service account', () => {
    assert.deepEqual(testCredential('FIREBASE', FIREBASE_SA), { ok: true });
  });

  it('rejects Firebase credentials that are not valid service accounts', () => {
    assert.deepEqual(testCredential('FIREBASE', 'not-json'), {
      ok: false,
      error: 'Firebase credential must be a JSON service account',
    });

    assert.deepEqual(
      testCredential('FIREBASE', JSON.stringify({ client_email: 'deploy@devops.iam.gserviceaccount.com' })),
      { ok: false, error: 'Invalid Firebase private_key' },
    );

    assert.deepEqual(
      testCredential(
        'FIREBASE',
        JSON.stringify({
          client_email: 'plain@example.com',
          private_key: '-----BEGIN PRIVATE KEY-----',
          project_id: 'p',
        }),
      ),
      { ok: false, error: 'Invalid Firebase client_email' },
    );

    assert.deepEqual(
      testCredential(
        'FIREBASE',
        JSON.stringify({
          client_email: 'deploy@devops.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----',
          project_id: '',
        }),
      ),
      { ok: false, error: 'Invalid Firebase project_id' },
    );
  });
});
