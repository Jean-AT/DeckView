import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const lockPath = path.join(rootDir, 'package-lock.json');

const BANNED = [
  'keyv',
  'flat-cache',
  'file-entry-cache',
  'cacheable-request',
  'cacheable',
  '@cacheable/memory',
  '@cacheable/node-cache',
  '@cacheable/utils',
  '@cacheable/net',
  'cache-manager',
  'ecto',
  '@deliveroo/reevent',
  '@or-sdk/invitations',
  '@picsart/ai-sdk',
  '@qlik/embed-runtime',
  'picasso.js',
];

const lock = JSON.parse(await readFile(lockPath, 'utf8'));

const found = new Map();

for (const [key, info] of Object.entries(lock.packages ?? {})) {
  const version = String(info?.version ?? '');
  for (const banned of BANNED) {
    if (key === `node_modules/${banned}` || key.startsWith(`node_modules/${banned}/`)) {
      found.set(banned, version);
    }
  }
}

if (found.size > 0) {
  console.error('❌ Banned packages found in lockfile:');
  for (const [name, version] of found) {
    console.error(`   - ${name}@${version}`);
  }
  process.exit(1);
}

console.log('✅ No banned packages in lockfile.');
