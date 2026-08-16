import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('server-only', () => ({}));

const { __resetCloudRunClientForTesting } = await import('@/lib/cloudrun/client');
const { resetEnvForTests } = await import('@/lib/env');
const { signPlaygroundProxyAuthPayload } = await import('@/effect/playground-proxy-auth');
const { GET: legacyNewsGet } = await import('../../../coingecko/news/route');
const { GET: feedGet } = await import('./route');

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_LOG = console.log;
const ORIGINAL_WARN = console.warn;
const ORIGINAL_ERROR = console.error;

const ENV_KEYS = [
    'COINGECKO_API_KEY',
    'TOKENS_CLOUDRUN_AUTH_TOKEN',
    'TOKENS_CLOUDRUN_ASSETS_URL',
    'TOKENS_CLOUDRUN_PRICES_URL',
    'TOKENS_CLOUDRUN_USAGE_URL',
    'TOKENS_PLAYGROUND_PROXY_SECRET',
    'TOKENS_USAGE_LOG_MODE',
    'TOKENS_REDIS_TARGET',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

beforeEach(() => {
    for (const key of ENV_KEYS) {
        const value = process.env[key];
        if (value !== undefined) savedEnv[key] = value;
        else delete savedEnv[key];
        delete process.env[key];
    }

    process.env.COINGECKO_API_KEY = 'enterprise-key';
    process.env.TOKENS_CLOUDRUN_AUTH_TOKEN = 'cloudrun-token';
    process.env.TOKENS_CLOUDRUN_ASSETS_URL = 'https://assets.example.run.app';
    process.env.TOKENS_CLOUDRUN_PRICES_URL = 'https://prices.example.run.app';
    process.env.TOKENS_CLOUDRUN_USAGE_URL = 'https://usage.example.run.app';
    process.env.TOKENS_PLAYGROUND_PROXY_SECRET = 'test-playground-secret';
    process.env.TOKENS_USAGE_LOG_MODE = 'off';
    resetEnvForTests();
    __resetCloudRunClientForTesting();

    console.log = () => undefined;
    console.warn = () => undefined;
    console.error = () => undefined;
});

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    console.log = ORIGINAL_LOG;
    console.warn = ORIGINAL_WARN;
    console.error = ORIGINAL_ERROR;

    for (const key of ENV_KEYS) {
        const value = savedEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    resetEnvForTests();
    __resetCloudRunClientForTesting();
});

async function authHeader(): Promise<string> {
    const now = Date.now();
    return signPlaygroundProxyAuthPayload({
        apiKeyId: 'test-key',
        keyPrefix: 'tk_test',
        projectId: 'test-project',
        ownerClerkUserId: 'test-user',
        scopes: ['assets:read'],
        iat: now,
        exp: now + 60_000,
    });
}

function newsArticle() {
    return {
        title: 'Bitcoin update',
        url: 'https://example.com/bitcoin',
        image: '',
        author: 'Reporter',
        posted_at: '2026-08-15T12:00:00.000Z',
        type: 'news',
        source_name: 'Example',
        related_coin_ids: ['bitcoin'],
    };
}

async function request(
    handler: (request: Request, context: never) => Promise<Response>,
    path: string,
): Promise<Response> {
    return handler(
        new Request(`https://api.example.test${path}`, {
            headers: { 'x-tokens-playground-auth': await authHeader() },
        }),
        {} as never,
    );
}

describe('CoinGecko news route catalog boundary', () => {
    it('lets active ids reach CoinGecko in both news routes', async () => {
        let upstreamCalls = 0;
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/query/coingeckoReadsGetCoinById')) {
                return new Response(JSON.stringify({ lastSyncedAt: Date.now() }), { status: 200 });
            }
            if (url.startsWith('https://pro-api.coingecko.com/api/v3/news')) {
                upstreamCalls += 1;
                return new Response(JSON.stringify([newsArticle()]), { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        const feedResponse = await request(feedGet, '/api/v1/news/feed?source=news&coin_id=bitcoin');
        const legacyResponse = await request(legacyNewsGet, '/api/coingecko/news?coin_id=bitcoin');

        expect(feedResponse.status).toBe(200);
        expect(legacyResponse.status).toBe(200);
        expect(upstreamCalls).toBe(2);
    });

    it('skips a missing internal id in both news routes without an upstream call', async () => {
        let upstreamCalls = 0;
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/query/coingeckoReadsGetCoinById')) {
                return new Response('null', { status: 200 });
            }
            if (url.startsWith('https://pro-api.coingecko.com/api/v3/news')) {
                upstreamCalls += 1;
                return new Response(JSON.stringify([newsArticle()]), { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        const feedResponse = await request(feedGet, '/api/v1/news/feed?source=news&coin_id=stock-tzuc3szn');
        const legacyResponse = await request(legacyNewsGet, '/api/coingecko/news?coin_id=stock-tzuc3szn');
        const feedBody = (await feedResponse.json()) as { items: unknown[] };
        const legacyBody = (await legacyResponse.json()) as unknown[];

        expect(feedResponse.status).toBe(200);
        expect(legacyResponse.status).toBe(200);
        expect(feedBody.items).toEqual([]);
        expect(legacyBody).toEqual([]);
        expect(upstreamCalls).toBe(0);
    });

    it('returns HTTP 200 with an empty feed when catalog validation fails', async () => {
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/query/coingeckoReadsGetCoinById')) {
                return new Response('catalog unavailable', { status: 500 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        const response = await request(feedGet, '/api/v1/news/feed?source=news&coin_id=bitcoin');
        const body = (await response.json()) as { items: unknown[] };

        expect(response.status).toBe(200);
        expect(body.items).toEqual([]);
    });

    it('continues to fetch global news without a catalog lookup', async () => {
        let catalogCalls = 0;
        let upstreamCalls = 0;
        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/query/coingeckoReadsGetCoinById')) {
                catalogCalls += 1;
                return new Response('null', { status: 200 });
            }
            if (url.startsWith('https://pro-api.coingecko.com/api/v3/news')) {
                upstreamCalls += 1;
                return new Response(JSON.stringify([newsArticle()]), { status: 200 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }) as typeof fetch;

        const response = await request(feedGet, '/api/v1/news/feed?source=news');
        const body = (await response.json()) as { items: unknown[] };

        expect(response.status).toBe(200);
        expect(body.items.length).toBe(1);
        expect(catalogCalls).toBe(0);
        expect(upstreamCalls).toBe(1);
    });
});
