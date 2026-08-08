import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/utils/password';

describe('password utils', () => {
  it('hashes a password and verifies it correctly', async () => {
    const hash = await hashPassword('supersecret');
    assert.notEqual(hash, 'supersecret');
    assert.ok(await verifyPassword('supersecret', hash));
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('supersecret');
    assert.equal(await verifyPassword('wrong', hash), false);
  });

  it('produces unique hashes for the same password', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    assert.notEqual(a, b);
  });
});
