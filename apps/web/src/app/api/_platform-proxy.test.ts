import { afterEach, beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test';

mock.module('server-only', () => ({}));

const { proxyPlatformRequest, proxyPlatformError } = await import('./_platform-proxy');

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = ['API_BASE_URL', 'TOKENS_API_ORIGIN', 'TOKENS_PLATFORM_API_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};

let errorSpy: Mock<typeof console.error>;

beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.API_BASE_URL = 'https://api.example.test';
    process.env.TOKENS_PLATFORM_API_KEY = 'platform-key';
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
    }
    errorSpy.mockRestore();
});

function setFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
    globalThis.fetch = impl as unknown as typeof fetch;
}

function getRequest(path: string, headers?: Record<string, string>): Request {
    return new Request(`https://web.example.test${path}`, { headers });
}

describe('proxyPlatformRequest', () => {
    it('passes through status, body, and applies cache-control for cached GETs', async () => {
        setFetch(async () =>
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json', 'x-upstream': 'yes' },
            }),
        );
        const res = await proxyPlatformRequest(getRequest('/api/v1/assets/search?q=sol'), { next: { revalidate: 60 } }, 30);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(res.headers.get('x-upstream')).toBe('yes');
        expect(res.headers.get('cache-control')).toBe('public, s-maxage=30, stale-while-revalidate=120');
    });

    it('sets no-store on non-2xx GETs with a cache window', async () => {
        setFetch(async () => new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } }));
        const res = await proxyPlatformRequest(getRequest('/api/v1/x'), { next: { revalidate: 60 } }, 30);
        expect(res.status).toBe(502);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('strips sensitive request headers and sets the platform key', async () => {
        let sawHeaders: Headers | null = null;
        setFetch(async (_url, init) => {
            sawHeaders = new Headers(init?.headers);
            return new Response('{}', { status: 200 });
        });
        await proxyPlatformRequest(
            getRequest('/api/v1/x', { cookie: 'secret', authorization: 'Bearer nope', 'x-custom': 'keep' }),
        );
        expect(sawHeaders!.get('cookie')).toBeNull();
        expect(sawHeaders!.get('authorization')).toBeNull();
        expect(sawHeaders!.get('x-api-key')).toBe('platform-key');
        expect(sawHeaders!.get('x-custom')).toBe('keep');
    });

    it('strips proxy-unsafe response headers', async () => {
        setFetch(async () =>
            new Response('{}', {
                status: 200,
                headers: { 'content-encoding': 'zstd', 'x-middleware-rewrite': '/x', 'x-keep': 'yes' },
            }),
        );
        const res = await proxyPlatformRequest(getRequest('/api/v1/x'));
        expect(res.headers.get('content-encoding')).toBeNull();
        expect(res.headers.get('x-middleware-rewrite')).toBeNull();
        expect(res.headers.get('x-keep')).toBe('yes');
    });

    it('retries a GET once on network failure', async () => {
        let calls = 0;
        setFetch(async () => {
            calls++;
            if (calls === 1) throw new Error('socket hang up');
            return new Response('{}', { status: 200 });
        });
        const res = await proxyPlatformRequest(getRequest('/api/v1/x'));
        expect(res.status).toBe(200);
        expect(calls).toBe(2);
    });

    it('does not retry GETs on HTTP error statuses', async () => {
        let calls = 0;
        setFetch(async () => {
            calls++;
            return new Response('{}', { status: 503 });
        });
        const res = await proxyPlatformRequest(getRequest('/api/v1/x'));
        expect(res.status).toBe(503);
        expect(calls).toBe(1);
    });

    it('never retries POSTs and forwards the body', async () => {
        let calls = 0;
        let sawBody: string | null = null;
        setFetch(async (_url, init) => {
            calls++;
            if (calls === 1) {
                sawBody = init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : null;
                throw new Error('socket hang up');
            }
            return new Response('{}', { status: 200 });
        });
        const request = new Request('https://web.example.test/api/v1/x', {
            method: 'POST',
            body: JSON.stringify({ hello: 'world' }),
        });
        let thrown: unknown;
        try {
            await proxyPlatformRequest(request);
        } catch (err) {
            thrown = err;
        }
        expect((thrown as { _tag?: string })?._tag).toBe('FetchFailedError');
        expect(calls).toBe(1);
        expect(sawBody).toContain('hello');
    });
});

describe('proxyPlatformError', () => {
    it('returns the identical 500 envelope and logs a structured error', async () => {
        const res = proxyPlatformError(new Error('boom'));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: { _tag: 'InternalServerError', message: 'Request proxy failed' } });
        expect(errorSpy.mock.calls.length).toBe(1);
    });
});
