import type { Provider } from '@prisma/client';

export interface CredentialTestResult {
  ok: boolean;
  error?: string;
}

// TODO Fase 3+: sustituir por una llamada real de solo lectura al proveedor
// (Vercel: GET /v2/user; GitHub: GET /user; Jenkins: GET /api/json, etc.).
const PROVIDER_KEY_PATTERNS: Record<Provider, RegExp | null> = {
  VERCEL: /^vercel_/,
  GITHUB_ACTIONS: /^(ghp_|gho_|github_pat_)/,
  JENKINS: null,
  AWS: null,
  FIREBASE: null,
};

export function testCredential(provider: Provider, value: string): CredentialTestResult {
  const pattern = PROVIDER_KEY_PATTERNS[provider];

  if (pattern && !pattern.test(value)) {
    return { ok: false, error: `Invalid ${provider} key format` };
  }

  if (value.length < 10) {
    return { ok: false, error: 'Key too short' };
  }

  return { ok: true };
}
