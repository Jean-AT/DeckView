import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from '../src/utils/jwt';
import { env } from '../src/config/env';

describe('jwt utils', () => {
  it('signs and verifies an access token', () => {
    const token = signToken({ sub: 'user-1', role: 'ADMIN', kind: 'access' });
    assert.deepEqual(verifyToken(token, 'access'), {
      sub: 'user-1',
      role: 'ADMIN',
      kind: 'access',
    });
  });

  it('signs and verifies a refresh token', () => {
    const token = signToken({ sub: 'user-1', role: 'VIEWER', kind: 'refresh' });
    const payload = verifyToken(token, 'refresh');
    assert.equal(payload.kind, 'refresh');
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = jwt.sign({ sub: 'u', role: 'ADMIN', kind: 'access' }, 'wrong-secret-abcdefghijklmnop');
    assert.throws(() => verifyToken(token, 'access'), jwt.JsonWebTokenError);
  });

  it('rejects a token of the wrong kind', () => {
    const refresh = signToken({ sub: 'user-1', role: 'ADMIN', kind: 'refresh' });
    assert.throws(() => verifyToken(refresh, 'access'), jwt.JsonWebTokenError);
  });

  it('rejects expired tokens', async () => {
    const token = jwt.sign({ sub: 'u', role: 'ADMIN', kind: 'access' }, env.JWT_SECRET, {
      expiresIn: '1ms',
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.throws(() => verifyToken(token, 'access'), jwt.TokenExpiredError);
  });

  it('rejects tokens with an invalid payload', () => {
    const token = jwt.sign({ sub: 'u', kind: 'access' }, env.JWT_SECRET, { expiresIn: '15m' });
    assert.throws(() => verifyToken(token, 'access'), jwt.JsonWebTokenError);
  });
});
