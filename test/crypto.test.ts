import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, maskSecret } from '../src/utils/cipher';

describe('cipher utils', () => {
  it('decrypts a value encrypted with the same key', () => {
    const secret = 'vercel_abcdefghijklmnopqrstuvwxyz';

    const encrypted = encryptSecret(secret);

    assert.equal(decryptSecret(encrypted), secret);
  });

  it('produces different iv and ciphertext for the same input (non-deterministic)', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');

    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.equal(decryptSecret(a), decryptSecret(b));
  });

  it('fails to decrypt when the auth tag is tampered', () => {
    const encrypted = encryptSecret('super-secret-value');
    const tampered = { ...encrypted, tag: '00'.repeat(16) };

    assert.throws(() => decryptSecret(tampered));
  });

  it('masks the secret keeping only the last 4 chars', () => {
    assert.equal(maskSecret('vercel_abcdefghijklmnopqrstuvwxyz'), '••••wxyz');
    assert.equal(maskSecret('ab'), '••••');
  });
});
