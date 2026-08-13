import { Duration, Effect } from 'effect';

export interface TokenCache<E> {
    /** Resolve the token, fetching (and caching) when cold or expired. Concurrent gets share one fetch. */
    readonly get: Effect.Effect<string, E>;
    /** Drop the cached token so the next `get` re-fetches (e.g. after a 401). */
    readonly invalidate: Effect.Effect<void>;
}

/**
 * TTL'd OAuth bearer-token cache. Replaces the module-level
 * `let cachedBearerToken` pattern, which cached tokens forever and only
 * dropped them when a request happened to fail.
 */
export function makeOAuth2TokenCache<E>(
    fetchToken: Effect.Effect<string, E>,
    ttl: Duration.Input = '55 minutes',
): TokenCache<E> {
    // Constructing the cached pair is pure; module-scope runSync matches the
    // repo's singleton style.
    const [cachedGet, invalidate] = Effect.runSync(Effect.cachedInvalidateWithTTL(fetchToken, ttl));
    // cachedInvalidateWithTTL caches failed exits for the TTL too — a transient
    // OAuth outage must not pin a failure for 55 minutes, so drop the cache
    // entry whenever a get fails (the failing wave still shares one fetch).
    const get = cachedGet.pipe(Effect.tapError(() => invalidate));
    return { get, invalidate };
}
