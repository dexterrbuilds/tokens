import { describe, expect, it } from 'bun:test';
import { Effect, Exit } from 'effect';

import { CloudRunCallError, CloudRunClient, makeCloudRunCaller, type CloudRunClientConfig } from './client';
import type { CloudRunError } from './errors';

const BASE_URLS = { assets: 'https://tokens-assets-stg.example.run.app' } as const;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function clientWithFetch(fetchImpl: typeof fetch, timeoutMs?: number): CloudRunClient {
    return new CloudRunClient({
        baseUrls: BASE_URLS,
        authToken: 'test-token',
        fetch: fetchImpl,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
}

describe('CloudRunClient retries', () => {
    it('does not retry by default', async () => {
        let calls = 0;
        const client = clientWithFetch((async () => {
            calls++;
            return jsonResponse({ error: 'boom' }, 503);
        }) as typeof fetch);

        let thrown: unknown;
        try {
            await client.query('assets', 'someQuery');
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(CloudRunCallError);
        expect(calls).toBe(1);
    });

    it('retries a 5xx and succeeds on the second attempt', async () => {
        let calls = 0;
        const client = clientWithFetch((async () => {
            calls++;
            if (calls === 1) return jsonResponse({ error: 'boom' }, 503);
            return jsonResponse({ ok: true });
        }) as typeof fetch);

        const result = await client.query('assets', 'someQuery', {}, { maxRetries: 1, retryDelayMs: 1 });
        expect(result).toEqual({ ok: true });
        expect(calls).toBe(2);
    });

    it('retries network failures', async () => {
        let calls = 0;
        const client = clientWithFetch((async () => {
            calls++;
            if (calls === 1) throw new Error('socket hang up');
            return jsonResponse({ ok: true });
        }) as typeof fetch);

        const result = await client.query('assets', 'someQuery', {}, { maxRetries: 1, retryDelayMs: 1 });
        expect(result).toEqual({ ok: true });
        expect(calls).toBe(2);
    });

    it('does not retry a 4xx', async () => {
        let calls = 0;
        const client = clientWithFetch((async () => {
            calls++;
            return jsonResponse({ error: 'nope' }, 404);
        }) as typeof fetch);

        let thrown: unknown;
        try {
            await client.query('assets', 'someQuery', {}, { maxRetries: 3, retryDelayMs: 1 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(CloudRunCallError);
        expect((thrown as CloudRunCallError).status).toBe(404);
        expect(calls).toBe(1);
    });

    it('never retries mutations, even when maxRetries is set', async () => {
        let calls = 0;
        const client = clientWithFetch((async () => {
            calls++;
            return jsonResponse({ error: 'boom' }, 503);
        }) as typeof fetch);

        let thrown: unknown;
        try {
            await client.mutation('assets', 'someMutation', {}, { maxRetries: 3, retryDelayMs: 1 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(CloudRunCallError);
        expect(calls).toBe(1);
    });

    it('gives up after maxRetries and throws the last error', async () => {
        let calls = 0;
        const client = clientWithFetch((async () => {
            calls++;
            return jsonResponse({ error: 'boom' }, 502);
        }) as typeof fetch);

        let thrown: unknown;
        try {
            await client.query('assets', 'someQuery', {}, { maxRetries: 2, retryDelayMs: 1 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(CloudRunCallError);
        expect((thrown as CloudRunCallError).status).toBe(502);
        expect(calls).toBe(3);
    });
});

describe('CloudRunClient per-call timeout', () => {
    it('honors the per-call timeout override and reports it in the error', async () => {
        const hangingFetch = ((_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    const abortError = new Error('aborted');
                    abortError.name = 'AbortError';
                    reject(abortError);
                });
            })) as typeof fetch;

        // Client-level timeout is long; the per-call override must win.
        const client = clientWithFetch(hangingFetch, 60_000);

        let thrown: unknown;
        try {
            await client.query('assets', 'someQuery', {}, { timeoutMs: 20 });
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(CloudRunCallError);
        expect((thrown as CloudRunCallError).message).toContain('timed out after 20ms');
    });

    it('retries after a timeout', async () => {
        let calls = 0;
        const flakyFetch = ((_url: unknown, init?: RequestInit) => {
            calls++;
            if (calls === 1) {
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        const abortError = new Error('aborted');
                        abortError.name = 'AbortError';
                        reject(abortError);
                    });
                });
            }
            return Promise.resolve(jsonResponse({ ok: true }));
        }) as typeof fetch;

        const client = clientWithFetch(flakyFetch);
        const result = await client.query(
            'assets',
            'someQuery',
            {},
            { timeoutMs: 20, maxRetries: 1, retryDelayMs: 1 },
        );
        expect(result).toEqual({ ok: true });
        expect(calls).toBe(2);
    });
});

// -----------------------------------------------------------------------------
// Effect API (makeCloudRunCaller)
// -----------------------------------------------------------------------------

function callerWithFetch(fetchImpl: typeof fetch, extra?: Partial<CloudRunClientConfig>) {
    return makeCloudRunCaller({
        baseUrls: BASE_URLS,
        authToken: 'test-token',
        fetch: fetchImpl,
        ...extra,
    });
}

async function failureOf<T>(effect: Effect.Effect<T, CloudRunError>): Promise<CloudRunError> {
    const exit = await Effect.runPromiseExit(effect);
    if (!Exit.isFailure(exit)) throw new Error('expected failure');
    const reason = exit.cause.reasons[0];
    if (!reason || reason._tag !== 'Fail') throw new Error(`expected Fail reason, got ${reason?._tag}`);
    return reason.error as CloudRunError;
}

describe('makeCloudRunCaller (Effect API)', () => {
    it('succeeds and parses JSON', async () => {
        const caller = callerWithFetch((async () => jsonResponse({ ok: true })) as typeof fetch);
        const result = await Effect.runPromise(caller.query('assets', 'someQuery'));
        expect(result).toEqual({ ok: true });
    });

    it('fails with CloudRunHttpError on non-2xx, carrying status and body', async () => {
        const caller = callerWithFetch((async () => jsonResponse({ error: 'nope' }, 404)) as typeof fetch);
        const error = await failureOf(caller.query('assets', 'someQuery'));
        expect(error._tag).toBe('CloudRunHttpError');
        if (error._tag === 'CloudRunHttpError') {
            expect(error.status).toBe(404);
            expect(error.body).toContain('nope');
            expect(error.callName).toBe('someQuery');
        }
    });

    it('fails with CloudRunTransportError on network failure', async () => {
        const caller = callerWithFetch((async () => {
            throw new Error('socket hang up');
        }) as typeof fetch);
        const error = await failureOf(caller.query('assets', 'someQuery'));
        expect(error._tag).toBe('CloudRunTransportError');
        if (error._tag === 'CloudRunTransportError') expect(error.cause).toBe('socket hang up');
    });

    it('fails with CloudRunTransportError on invalid JSON', async () => {
        const caller = callerWithFetch((async () =>
            new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch);
        const error = await failureOf(caller.query('assets', 'someQuery'));
        expect(error._tag).toBe('CloudRunTransportError');
    });

    it('fails with MissingEnvError when no base URL is configured', async () => {
        const caller = callerWithFetch((async () => jsonResponse({ ok: true })) as typeof fetch);
        const error = await failureOf(caller.query('admin', 'someQuery'));
        expect(error._tag).toBe('MissingEnvError');
        expect(error.message).toContain("no base URL configured for service 'admin'");
    });

    it('fails with CloudRunTimeoutError and reports the timeout', async () => {
        const hangingFetch = ((_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    const abortError = new Error('aborted');
                    abortError.name = 'AbortError';
                    reject(abortError);
                });
            })) as typeof fetch;
        const caller = callerWithFetch(hangingFetch, { timeoutMs: 60_000 });
        const error = await failureOf(caller.query('assets', 'someQuery', {}, { timeoutMs: 20 }));
        expect(error._tag).toBe('CloudRunTimeoutError');
        expect(error.message).toContain('timed out after 20ms');
    });

    it('retries a 5xx query and succeeds on the second attempt', async () => {
        let calls = 0;
        const caller = callerWithFetch((async () => {
            calls++;
            if (calls === 1) return jsonResponse({ error: 'boom' }, 503);
            return jsonResponse({ ok: true });
        }) as typeof fetch);
        const result = await Effect.runPromise(
            caller.query('assets', 'someQuery', {}, { maxRetries: 1, retryDelayMs: 1 }),
        );
        expect(result).toEqual({ ok: true });
        expect(calls).toBe(2);
    });

    it('does not retry a 4xx query', async () => {
        let calls = 0;
        const caller = callerWithFetch((async () => {
            calls++;
            return jsonResponse({ error: 'nope' }, 404);
        }) as typeof fetch);
        const error = await failureOf(caller.query('assets', 'someQuery', {}, { maxRetries: 3, retryDelayMs: 1 }));
        expect(error._tag).toBe('CloudRunHttpError');
        expect(calls).toBe(1);
    });

    it('never retries mutations', async () => {
        let calls = 0;
        const caller = callerWithFetch((async () => {
            calls++;
            return jsonResponse({ error: 'boom' }, 503);
        }) as typeof fetch);
        const error = await failureOf(
            caller.mutation('assets', 'someMutation', {}, { maxRetries: 3, retryDelayMs: 1 }),
        );
        expect(error._tag).toBe('CloudRunHttpError');
        expect(calls).toBe(1);
    });

    it('gives up after maxRetries with the last error', async () => {
        let calls = 0;
        const caller = callerWithFetch((async () => {
            calls++;
            return jsonResponse({ error: 'boom' }, 502);
        }) as typeof fetch);
        const error = await failureOf(caller.query('assets', 'someQuery', {}, { maxRetries: 2, retryDelayMs: 1 }));
        expect(error._tag).toBe('CloudRunHttpError');
        if (error._tag === 'CloudRunHttpError') expect(error.status).toBe(502);
        expect(calls).toBe(3);
    });

    it('interruption propagates abort to the in-flight fetch', async () => {
        let sawAbort = false;
        const hangingFetch = ((_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    sawAbort = true;
                    const abortError = new Error('aborted');
                    abortError.name = 'AbortError';
                    reject(abortError);
                });
            })) as typeof fetch;
        const caller = callerWithFetch(hangingFetch, { timeoutMs: 60_000 });

        const controller = new AbortController();
        const promise = Effect.runPromiseExit(caller.query('assets', 'someQuery'), { signal: controller.signal });
        await new Promise(resolve => setTimeout(resolve, 10));
        controller.abort();
        const exit = await promise;
        expect(Exit.isFailure(exit)).toBe(true);
        expect(sawAbort).toBe(true);
    });
});
