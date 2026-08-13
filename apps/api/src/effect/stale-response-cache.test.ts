import { beforeEach, describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { BadRequestError } from '@tokens/effect';

import type { RedisClient } from '@/lib/redis';
import {
    __resetStaleResponseCacheForTesting,
    withStaleFallback,
    type StaleFallbackOptions,
} from './stale-response-cache';

class FakeRedis implements Pick<RedisClient, 'get' | 'set'> {
    store = new Map<string, string>();
    lastSetOptions: { ex?: number; px?: number; nx?: boolean } | undefined;
    setCalls = 0;
    getCalls = 0;
    failWrites = false;
    failReads = false;

    async get<T = string>(key: string): Promise<T | null> {
        this.getCalls++;
        if (this.failReads) throw new Error('redis read failed');
        return (this.store.get(key) ?? null) as T | null;
    }

    async set(
        key: string,
        value: string | number,
        options?: { ex?: number; px?: number; nx?: boolean },
    ): Promise<'OK' | null> {
        this.setCalls++;
        this.lastSetOptions = options;
        if (this.failWrites) throw new Error('redis write failed');
        this.store.set(key, String(value));
        return 'OK';
    }
}

function optionsWith(
    redis: FakeRedis,
    overrides: Partial<StaleFallbackOptions<Record<string, unknown>>> = {},
): StaleFallbackOptions<Record<string, unknown>> {
    return {
        operation: 'test.op',
        cacheKey: 'stale-response:v1:test',
        ttlSeconds: 900,
        writeIntervalMs: 0,
        getClient: () => redis as unknown as RedisClient,
        ...overrides,
    };
}

function serverError<A extends Record<string, unknown>>(
    message: string,
): Effect.Effect<A, unknown, never> {
    return Effect.tryPromise(() => Promise.reject(new Error(message)) as Promise<A>);
}

describe('withStaleFallback', () => {
    beforeEach(() => {
        __resetStaleResponseCacheForTesting();
    });

    it('passes successful payloads through unchanged and caches them', async () => {
        const redis = new FakeRedis();
        const payload = { listId: 'all', assets: [{ assetId: 'solana' }] };

        const result = await Effect.runPromise(
            withStaleFallback(optionsWith(redis), Effect.succeed(payload)),
        );

        expect(result).toEqual(payload);
        expect('stale' in result).toBe(false);
        expect(redis.setCalls).toBe(1);
        expect(redis.store.get('stale-response:v1:test')).toContain('"listId":"all"');
        // Entries must expire — an immortal last-good payload would serve
        // arbitrarily old data during a long outage.
        expect(redis.lastSetOptions?.ex).toBe(900);
    });

    it('serves the last-good payload with stale markers on server error', async () => {
        const redis = new FakeRedis();
        const payload = { listId: 'all', assets: [{ assetId: 'solana' }] };

        await Effect.runPromise(withStaleFallback(optionsWith(redis), Effect.succeed(payload)));

        const result = await Effect.runPromise(
            withStaleFallback(
                optionsWith(redis),
                serverError<{ listId: string; assets: unknown[] }>('downstream timeout'),
            ),
        );

        expect(result.listId).toBe('all');
        expect(result.assets).toEqual([{ assetId: 'solana' }]);
        expect((result as Record<string, unknown>).stale).toBe(true);
        expect(typeof (result as Record<string, unknown>).staleCachedAt).toBe('number');
    });

    it('propagates the original error when there is no cached payload', async () => {
        const redis = new FakeRedis();

        let thrown: unknown;
        try {
            await Effect.runPromise(
                withStaleFallback(optionsWith(redis), serverError('downstream timeout')),
            );
        } catch (err) {
            thrown = err;
        }
        expect(String((thrown as Error | undefined)?.cause)).toContain('downstream timeout');
    });

    it('never masks 4xx-class failures with stale data', async () => {
        const redis = new FakeRedis();
        await Effect.runPromise(
            withStaleFallback(optionsWith(redis), Effect.succeed({ listId: 'all' })),
        );

        let thrown: unknown;
        try {
            await Effect.runPromise(
                withStaleFallback(
                    optionsWith(redis),
                    Effect.fail(new BadRequestError({ message: 'Invalid limit' })),
                ),
            );
        } catch (err) {
            thrown = err;
        }
        expect(String(thrown)).toContain('Invalid limit');
        // The fallback read must not even be attempted for client errors.
        expect(redis.getCalls).toBe(0);
    });

    it('propagates the original error when the fallback read also fails', async () => {
        const redis = new FakeRedis();
        await Effect.runPromise(
            withStaleFallback(optionsWith(redis), Effect.succeed({ listId: 'all' })),
        );
        redis.failReads = true;

        let thrown: unknown;
        try {
            await Effect.runPromise(
                withStaleFallback(optionsWith(redis), serverError('downstream timeout')),
            );
        } catch (err) {
            thrown = err;
        }
        expect(String((thrown as Error | undefined)?.cause)).toContain('downstream timeout');
    });

    it('does not fail the request when the cache write fails', async () => {
        const redis = new FakeRedis();
        redis.failWrites = true;

        const result = await Effect.runPromise(
            withStaleFallback(optionsWith(redis), Effect.succeed({ listId: 'all' })),
        );
        expect(result).toEqual({ listId: 'all' });
    });

    it('throttles cache writes within the write interval', async () => {
        const redis = new FakeRedis();
        const options = optionsWith(redis, { writeIntervalMs: 60_000 });

        await Effect.runPromise(withStaleFallback(options, Effect.succeed({ listId: 'all' })));
        await Effect.runPromise(withStaleFallback(options, Effect.succeed({ listId: 'all' })));

        expect(redis.setCalls).toBe(1);
    });

    it('never caches unhealthy payloads and serves the last healthy one instead', async () => {
        const redis = new FakeRedis();
        const isHealthy = (payload: Record<string, unknown>) =>
            Array.isArray(payload.assets) && payload.assets.length > 0;

        const healthy = { listId: 'all', assets: [{ assetId: 'solana' }] };
        await Effect.runPromise(
            withStaleFallback(optionsWith(redis, { isHealthy }), Effect.succeed(healthy)),
        );
        expect(redis.setCalls).toBe(1);

        const hollow = { listId: 'all', assets: [] as unknown[] };
        const result = await Effect.runPromise(
            withStaleFallback(optionsWith(redis, { isHealthy }), Effect.succeed(hollow)),
        );

        // The hollow 200 was replaced by the cached healthy payload…
        expect(result.assets).toEqual([{ assetId: 'solana' }]);
        expect((result as Record<string, unknown>).stale).toBe(true);
        // …and was never written to the cache.
        expect(redis.setCalls).toBe(1);
    });

    it('returns the unhealthy payload unchanged when there is no cached fallback', async () => {
        const redis = new FakeRedis();
        const isHealthy = () => false;

        const payload = { listId: 'all', assets: [] as unknown[] };
        const result = await Effect.runPromise(
            withStaleFallback(optionsWith(redis, { isHealthy }), Effect.succeed(payload)),
        );

        expect(result).toEqual(payload);
        expect('stale' in result).toBe(false);
        expect(redis.setCalls).toBe(0);
    });

    it('arms the write throttle even when the payload is too large to cache', async () => {
        const redis = new FakeRedis();
        const options = optionsWith(redis, { writeIntervalMs: 60_000 });
        // ~5MB payload — exceeds MAX_CACHEABLE_CHARS.
        const huge = { listId: 'all', blob: 'x'.repeat(5_000_000) };

        await Effect.runPromise(withStaleFallback(options, Effect.succeed(huge)));
        await Effect.runPromise(withStaleFallback(options, Effect.succeed(huge)));

        // Nothing was cached, and the second request must have been throttled
        // before re-serializing (setCalls stays 0 either way; the observable
        // throttle effect is that a later *small* payload is also skipped
        // within the interval).
        expect(redis.setCalls).toBe(0);
        await Effect.runPromise(withStaleFallback(options, Effect.succeed({ listId: 'all' })));
        expect(redis.setCalls).toBe(0);
    });

    it('ignores malformed cache entries and propagates the error', async () => {
        const redis = new FakeRedis();
        redis.store.set('stale-response:v1:test', 'not json {');

        let thrown: unknown;
        try {
            await Effect.runPromise(
                withStaleFallback(optionsWith(redis), serverError('downstream timeout')),
            );
        } catch (err) {
            thrown = err;
        }
        expect(String((thrown as Error | undefined)?.cause)).toContain('downstream timeout');
    });
});
