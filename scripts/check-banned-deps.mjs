import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const lockPath = path.join(rootDir, 'package-lock.json');

// These packages are ONLY acceptable at the pinned patched (non-compromised) versions.
const ALLOWED_PATCHED = {
  keyv: new Set(['4.5.4']),
  'flat-cache': new Set(['3.2.0']),
  'file-entry-cache': new Set(['6.0.1']),
};

// Any presence of these packages is a hard fail.
const BANNED_TOTAL = [
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

const failures = new Map();
const warnings = new Map();

for (const [key, info] of Object.entries(lock.packages ?? {})) {
  const version = String(info?.version ?? '');
  const name = key.startsWith('node_modules/')
    ? key.slice('node_modules/'.length)
    : key;
  const topName = name.split('/')[0] === '@' ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];

  if (topName in ALLOWED_PATCHED) {
    if (!ALLOWED_PATCHED[topName].has(version)) {
      failures.set(topName, version);
    }
  } else if (BANNED_TOTAL.includes(topName)) {
    failures.set(topName, version);
  }
}

if (failures.size > 0) {
  console.error('❌ Banned packages found in lockfile:');
  for (const [name, version] of failures) {
    console.error(`   - ${name}@${version}`);
  }
  process.exit(1);
}

console.log('✅ No banned packages in lockfile.');
