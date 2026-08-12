import { Effect } from 'effect';

import { getRedisClient, type RedisClient } from '@/lib/redis';
import { httpStatusForError, toApiErrorInfo } from '@tokens/effect';

/**
 * Last-good response cache: serve slightly stale data instead of a 500 or a
 * degraded (near-empty) 200.
 *
 * `withStaleFallback` wraps a route handler effect so that
 * - every healthy successful payload is written to Redis (best-effort,
 *   throttled),
 * - a 5xx-class failure is answered with the last healthy payload for the
 *   same cache key (marked `stale: true`) when one exists, and
 * - an *unhealthy* success (per `isHealthy` — e.g. a payload assembled while
 *   every downstream call defaulted to empty) is replaced by the last healthy
 *   payload when one exists, and is never written to the cache.
 *
 * 4xx-class failures (bad request, auth, rate limit) are never masked — they
 * propagate unchanged. When Redis is unavailable or has no entry, the original
 * outcome propagates and behavior is identical to an unwrapped handler.
 */

export interface StaleFallbackOptions<A = Record<string, unknown>> {
    /** Label for log lines (e.g. `assets.curated`). */
    operation: string;
    /** Redis key holding the last-good payload for this request shape. */
    cacheKey: string;
    /** How long a last-good payload stays servable, in seconds. */
    ttlSeconds: number;
    /**
     * Health check for successful payloads. Unhealthy payloads are never
     * cached, and are swapped for the last healthy payload when one exists
     * (route handlers that default failed sub-calls to empty data can 200
     * with a hollow body — that hollow body must not become "last good").
     * Defaults to treating every success as healthy.
     */
    isHealthy?: (payload: A) => boolean;
    /**
     * Minimum interval between cache writes from this process, in ms.
     * Payloads can be large; rewriting on every request is wasteful when the
     * data only changes on the order of seconds. Defaults to 30s.
     */
    writeIntervalMs?: number;
    /** Test injection for the Redis client. Defaults to `getRedisClient()`. */
    getClient?: () => RedisClient;
}

interface StaleEnvelope {
    v: 1;
    cachedAt: number;
    payload: Record<string, unknown>;
}

/** Skip caching payloads larger than this many serialized bytes. */
const MAX_CACHEABLE_CHARS = 4_000_000;

const DEFAULT_WRITE_INTERVAL_MS = 30_000;

/** Per-process write throttle (serverless instances each keep their own). */
const lastWriteAtByKey = new Map<string, number>();

/** Bound the throttle map — arbitrary offset/limit combos yield unbounded keys. */
const MAX_THROTTLE_ENTRIES = 1_000;

function redisOrNull(getClient?: () => RedisClient): RedisClient | null {
    try {
        return (getClient ?? getRedisClient)();
    } catch {
        // Redis not configured — stale fallback silently disabled.
        return null;
    }
}

function parseEnvelope(raw: unknown): StaleEnvelope | null {
    try {
        // Upstash's REST client auto-deserializes JSON values; Memorystore
        // returns the raw string. Handle both.
        const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!value || typeof value !== 'object') return null;
        const envelope = value as Partial<StaleEnvelope>;
        if (envelope.v !== 1) return null;
        if (typeof envelope.cachedAt !== 'number' || !Number.isFinite(envelope.cachedAt)) return null;
        if (!envelope.payload || typeof envelope.payload !== 'object') return null;
        return envelope as StaleEnvelope;
    } catch {
        return null;
    }
}

async function writeLastGood(
    options: StaleFallbackOptions<never>,
    payload: Record<string, unknown>,
): Promise<void> {
    const writeIntervalMs = options.writeIntervalMs ?? DEFAULT_WRITE_INTERVAL_MS;
    const lastWriteAt = lastWriteAtByKey.get(options.cacheKey) ?? 0;
    const now = Date.now();
    if (now - lastWriteAt < writeIntervalMs) return;

    const redis = redisOrNull(options.getClient);
    if (!redis) return;

    // Arm the throttle before any early return — otherwise an oversized
    // payload would re-serialize on every request, bypassing the throttle.
    if (lastWriteAtByKey.size >= MAX_THROTTLE_ENTRIES) lastWriteAtByKey.clear();
    lastWriteAtByKey.set(options.cacheKey, now);

    const envelope: StaleEnvelope = { v: 1, cachedAt: now, payload };
    const body = JSON.stringify(envelope);
    if (body.length > MAX_CACHEABLE_CHARS) {
        console.error('Stale-response cache: payload too large to cache', {
            operation: options.operation,
            cacheKey: options.cacheKey,
            chars: body.length,
        });
        return;
    }

    await redis.set(options.cacheKey, body, { ex: options.ttlSeconds });
}

async function readLastGood(options: StaleFallbackOptions<never>): Promise<StaleEnvelope | null> {
    const redis = redisOrNull(options.getClient);
    if (!redis) return null;
    const raw = await redis.get<unknown>(options.cacheKey);
    if (raw === null || raw === undefined) return null;
    return parseEnvelope(raw);
}

export function withStaleFallback<A extends Record<string, unknown>, E, R>(
    options: StaleFallbackOptions<A>,
    effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | (A & { stale: true; staleCachedAt: number }), E, R> {
    type Out = A | (A & { stale: true; staleCachedAt: number });

    const readStale = Effect.tryPromise(() => readLastGood(options)).pipe(
        Effect.catch(() => Effect.succeed(null)),
    );

    const asStale = (envelope: StaleEnvelope): Out => ({
        ...(envelope.payload as A),
        stale: true as const,
        staleCachedAt: envelope.cachedAt,
    });

    return effect.pipe(
        Effect.flatMap((payload): Effect.Effect<Out, never, never> => {
            const healthy = options.isHealthy ? options.isHealthy(payload) : true;

            if (!healthy) {
                // A hollow success (every downstream call defaulted) must not
                // become "last good" — and callers are better served by the
                // previous healthy payload when we still have one.
                return readStale.pipe(
                    Effect.map(envelope => {
                        if (!envelope) return payload;
                        console.error('Serving stale cached response instead of unhealthy payload', {
                            operation: options.operation,
                            cacheKey: options.cacheKey,
                            cachedAt: envelope.cachedAt,
                            ageMs: Date.now() - envelope.cachedAt,
                        });
                        return asStale(envelope);
                    }),
                );
            }

            return Effect.tryPromise(() => writeLastGood(options, payload)).pipe(
                Effect.catch(error => {
                    console.error('Stale-response cache: write failed', {
                        operation: options.operation,
                        cacheKey: options.cacheKey,
                        error: toApiErrorInfo(error),
                    });
                    return Effect.void;
                }),
                Effect.as(payload),
            );
        }),
        Effect.catch(error => {
            // Never mask client errors (4xx) with stale data — only degrade on
            // server-side failures.
            if (httpStatusForError(error) < 500) return Effect.fail(error);

            return readStale.pipe(
                Effect.flatMap(envelope => {
                    if (!envelope) return Effect.fail(error);
                    console.error('Serving stale cached response after effect error', {
                        operation: options.operation,
                        cacheKey: options.cacheKey,
                        cachedAt: envelope.cachedAt,
                        ageMs: Date.now() - envelope.cachedAt,
                        error: toApiErrorInfo(error),
                    });
                    return Effect.succeed(asStale(envelope));
                }),
            );
        }),
    );
}

/** Test helper — reset the per-process write throttle. */
export function __resetStaleResponseCacheForTesting(): void {
    lastWriteAtByKey.clear();
}
