import { Data } from 'effect';
import { Redis as UpstashRedis } from '@upstash/redis';

import {
    getRedisTargetFromEnv,
    type EnvLike,
    type RedisClient,
    type RedisTarget,
} from './client';
import { MemorystoreClient } from './memorystore';
import { UpstashRedisClientAdapter } from './upstash-adapter';

export {
    getRedisTargetFromEnv,
    isMemorystoreEnabled,
    loadMemorystoreEnv,
    MissingMemorystoreEnvError,
    type MemorystoreEnv,
    type RedisClient,
    type RedisExpireFlag,
    type RedisPipeline,
    type RedisSetOptions,
    type RedisTarget,
} from './client';
/** A Redis command failed (network, script, or server error). */
export class RedisCommandError extends Data.TaggedError('RedisCommandError')<{
    message: string;
    command: string;
    cause?: string;
}> {}

export { MemorystoreClient } from './memorystore';
export { UpstashRedisClientAdapter } from './upstash-adapter';

let cached: { target: RedisTarget; client: RedisClient } | null = null;

export function getRedisClient(env: EnvLike = process.env as EnvLike): RedisClient {
    const target = getRedisTargetFromEnv(env);
    if (cached && cached.target === target) return cached.client;

    const client: RedisClient =
        target === 'memorystore' ? createMemorystoreClient(env) : createUpstashClient(env);

    cached = { target, client };
    return client;
}

function createMemorystoreClient(env: EnvLike): RedisClient {
    return MemorystoreClient.fromEnv(env);
}

function createUpstashClient(env: EnvLike): RedisClient {
    const url = env.UPSTASH_REDIS_REST_URL?.trim();
    const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
        throw new Error(
            'Upstash Redis is not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
        );
    }
    return new UpstashRedisClientAdapter(new UpstashRedis({ url, token }));
}

export function __resetRedisClientForTesting(): void {
    cached = null;
}
