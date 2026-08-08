import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

const KEY = (() => {
  const key = Buffer.from(env.CREDENTIALS_MASTER_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_MASTER_KEY must decode to exactly 32 bytes (AES-256)');
  }
  return key;
})();

export interface EncryptedSecret {
  ciphertext: string; // hex
  iv: string; // hex
  tag: string; // hex
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decryptSecret({ ciphertext, iv, tag }: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

export function maskSecret(secret: string): string {
  if (secret.length <= 4) return '••••';
  return `••••${secret.slice(-4)}`;
}
