import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/utils/rateLimiter';

describe('createRateLimiter', () => {
  it('allows requests up to the limit', () => {
    const limiter = createRateLimiter(2, 60_000);

    assert.equal(limiter.allow('github'), true);
    assert.equal(limiter.allow('github'), true);
    assert.equal(limiter.allow('github'), false);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter(1, 60_000);

    assert.equal(limiter.allow('github'), true);
    assert.equal(limiter.allow('jenkins'), true);
    assert.equal(limiter.allow('github'), false);
  });

  it('releases slots after the window elapses', async () => {
    const limiter = createRateLimiter(1, 40);

    assert.equal(limiter.allow('vercel'), true);
    assert.equal(limiter.allow('vercel'), false);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(limiter.allow('vercel'), true);
  });
});
