import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';

import type { RedisClient, RedisPipeline } from '@/lib/redis';
import { SLIDING_WINDOW_LIMIT_SCRIPT } from '@/lib/redis/lua';

import { slidingWindowLimit } from './sliding-window-rate-limit';

interface EvalCall {
    method: 'evalsha' | 'eval';
    script: string;
    keys: string[];
    args: Array<string | number>;
}

function makeStubRedis(behavior: {
    onCall: (call: EvalCall) => unknown | Error;
}): { redis: RedisClient; calls: EvalCall[] } {
    const calls: EvalCall[] = [];

    const redis: RedisClient = {
        async get<T = string>(): Promise<T | null> {
            throw new Error('not implemented');
        },
        async set(): Promise<'OK' | null> {
            throw new Error('not implemented');
        },
        pipeline(): RedisPipeline {
            throw new Error('not implemented');
        },
        async eval<T = unknown>(
            script: string,
            keys: string[],
            args: Array<string | number>,
        ): Promise<T> {
            const call: EvalCall = { method: 'eval', script, keys, args };
            calls.push(call);
            const result = behavior.onCall(call);
            if (result instanceof Error) throw result;
            return result as T;
        },
        async evalsha<T = unknown>(
            sha: string,
            keys: string[],
            args: Array<string | number>,
        ): Promise<T> {
            const call: EvalCall = { method: 'evalsha', script: sha, keys, args };
            calls.push(call);
            const result = behavior.onCall(call);
            if (result instanceof Error) throw result;
            return result as T;
        },
        async scriptLoad(): Promise<string> {
            throw new Error('not implemented');
        },
    };

    return { redis, calls };
}

describe('slidingWindowLimit', () => {
    it('issues an EVALSHA with the inlined sliding-window script SHA + matching key shape', async () => {
        const { redis, calls } = makeStubRedis({
            onCall: () => [10, 100] as [number, number],
        });

        const result = await Effect.runPromise(slidingWindowLimit({
            redis,
            identifier: 'key:abc',
            tokens: 100,
            windowSeconds: 10,
            now: 30_000, // currentWindow = 30000/10000 = 3
        }));

        expect(calls.length).toBe(1);
        const call = calls[0]!;
        expect(call.method).toBe('evalsha');
        expect(call.script).toBe(SLIDING_WINDOW_LIMIT_SCRIPT.sha1);
        expect(call.keys.length).toBe(3);
        expect(call.keys[0]).toBe('ratelimit:key:abc:3');
        expect(call.keys[1]).toBe('ratelimit:key:abc:2');
        expect(call.keys[2]).toBe('');
        expect(call.args.length).toBe(4);
        expect(call.args[0]).toBe(100);
        expect(call.args[1]).toBe(30_000);
        expect(call.args[2]).toBe(10_000);
        expect(call.args[3]).toBe(1);

        expect(result.success).toBe(true);
        expect(result.limit).toBe(100);
        expect(result.remaining).toBe(10);
        expect(result.reset).toBe(40_000); // (3 + 1) * 10_000
    });

    it('falls back to EVAL when EVALSHA returns NOSCRIPT', async () => {
        let firstCall = true;
        const { redis, calls } = makeStubRedis({
            onCall: () => {
                if (firstCall) {
                    firstCall = false;
                    return new Error('NOSCRIPT No matching script. Please use EVAL.');
                }
                return [5, 50] as [number, number];
            },
        });

        const result = await Effect.runPromise(slidingWindowLimit({
            redis,
            identifier: 'key:zzz',
            tokens: 50,
            windowSeconds: 1,
            now: 5_500,
        }));

        expect(calls.length).toBe(2);
        expect(calls[0]!.method).toBe('evalsha');
        expect(calls[1]!.method).toBe('eval');
        expect(calls[1]!.script).toBe(SLIDING_WINDOW_LIMIT_SCRIPT.script);
        expect(result.success).toBe(true);
        expect(result.remaining).toBe(5);
        expect(result.limit).toBe(50);
    });

    it('marks the request as rate-limited when the Lua script returns a negative remaining', async () => {
        const { redis } = makeStubRedis({
            onCall: () => [-1, 10] as [number, number],
        });

        const result = await Effect.runPromise(slidingWindowLimit({
            redis,
            identifier: 'key:x',
            tokens: 10,
            windowSeconds: 5,
            now: 1_000,
        }));

        expect(result.success).toBe(false);
        expect(result.remaining).toBe(0); // clamped to >= 0
        expect(result.limit).toBe(10);
        expect(result.reset).toBe(5_000); // (0 + 1) * 5_000
    });

    it('propagates non-NOSCRIPT eval errors without retry', async () => {
        const { redis, calls } = makeStubRedis({
            onCall: () => new Error('ECONNREFUSED'),
        });

        let threw = false;
        try {
            await Effect.runPromise(slidingWindowLimit({
                redis,
                identifier: 'key:y',
                tokens: 1,
                windowSeconds: 1,
            }));
        } catch (err) {
            threw = true;
            const redisError = err as { _tag: string; command: string; cause?: string };
            expect(redisError._tag).toBe('RedisCommandError');
            expect(redisError.command).toBe('evalsha');
            expect(redisError.cause).toBe('ECONNREFUSED');
        }
        expect(threw).toBe(true);
        expect(calls.length).toBe(1); // single EVALSHA attempt, no EVAL fallback
    });
});
