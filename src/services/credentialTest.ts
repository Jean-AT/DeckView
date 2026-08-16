import type { Provider } from '@prisma/client';

export interface CredentialTestResult {
  ok: boolean;
  error?: string;
}

// TODO Fase 3+: sustituir por una llamada real de solo lectura al proveedor
// (Vercel: GET /v2/user; GitHub: GET /user; Jenkins: GET /api/json, AWS: ListDeployments, etc.).
const PROVIDER_KEY_PATTERNS: Record<Provider, RegExp | null> = {
  VERCEL: /^vercel_/,
  GITHUB_ACTIONS: /^(ghp_|gho_|github_pat_)/,
  JENKINS: null,
  AWS: null,
  FIREBASE: null,
};

function testAwsCredential(value: string): CredentialTestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, error: 'AWS credential must be a JSON object' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'AWS credential must be a JSON object' };
  }

  const { accessKeyId, secretAccessKey, sessionToken } = parsed as Record<string, unknown>;

  if (typeof accessKeyId !== 'string' || !/^(AKIA|ASIA)/.test(accessKeyId)) {
    return { ok: false, error: 'Invalid AWS access key id (must start with AKIA or ASIA)' };
  }

  if (typeof secretAccessKey !== 'string' || secretAccessKey.length < 16) {
    return { ok: false, error: 'Invalid AWS secret access key' };
  }

  if (sessionToken !== undefined && typeof sessionToken !== 'string') {
    return { ok: false, error: 'AWS sessionToken must be a string' };
  }

  return { ok: true };
}

export function testCredential(provider: Provider, value: string): CredentialTestResult {
  if (provider === 'AWS') {
    return testAwsCredential(value);
  }

  const pattern = PROVIDER_KEY_PATTERNS[provider];

  if (pattern && !pattern.test(value)) {
    return { ok: false, error: `Invalid ${provider} key format` };
  }

  if (value.length < 10) {
    return { ok: false, error: 'Key too short' };
  }

  return { ok: true };
}
