import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import { makeOAuth2TokenCache } from './oauth-token-cache';

describe('makeOAuth2TokenCache', () => {
    it('fetches once and serves subsequent gets from the cache', async () => {
        let fetches = 0;
        const cache = makeOAuth2TokenCache(
            Effect.sync(() => {
                fetches += 1;
                return `token-${fetches}`;
            }),
        );

        expect(await Effect.runPromise(cache.get)).toBe('token-1');
        expect(await Effect.runPromise(cache.get)).toBe('token-1');
        expect(fetches).toBe(1);
    });

    it('dedupes concurrent cold gets into a single fetch', async () => {
        let fetches = 0;
        const cache = makeOAuth2TokenCache(
            Effect.promise(async () => {
                fetches += 1;
                await new Promise(resolve => setTimeout(resolve, 10));
                return 'token';
            }),
        );

        const results = await Promise.all([
            Effect.runPromise(cache.get),
            Effect.runPromise(cache.get),
            Effect.runPromise(cache.get),
        ]);
        expect(results).toEqual(['token', 'token', 'token']);
        expect(fetches).toBe(1);
    });

    it('re-fetches after invalidate', async () => {
        let fetches = 0;
        const cache = makeOAuth2TokenCache(
            Effect.sync(() => {
                fetches += 1;
                return `token-${fetches}`;
            }),
        );

        expect(await Effect.runPromise(cache.get)).toBe('token-1');
        await Effect.runPromise(cache.invalidate);
        expect(await Effect.runPromise(cache.get)).toBe('token-2');
        expect(fetches).toBe(2);
    });

    it('does not cache failures', async () => {
        let fetches = 0;
        const cache = makeOAuth2TokenCache(
            Effect.suspend(() => {
                fetches += 1;
                return fetches === 1 ? Effect.fail(new Error('boom')) : Effect.succeed('token');
            }),
        );

        let threw = false;
        try {
            await Effect.runPromise(cache.get);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
        expect(await Effect.runPromise(cache.get)).toBe('token');
    });
});
