import { describe, expect, it } from 'bun:test';

import { Effect } from 'effect';

import { __resetCloudRunClientForTesting } from './client';
import { authenticateApiKey, logApiRequest } from './platformAuth';

const ENV_KEYS = [
    'TOKENS_CLOUDRUN_AUTH_TOKEN',
    'TOKENS_CLOUDRUN_ASSETS_URL',
    'TOKENS_CLOUDRUN_PRICES_URL',
    'TOKENS_CLOUDRUN_USAGE_URL',
    'TOKENS_CLOUDRUN_ADMIN_URL',
    'TOKENS_CLOUDRUN_TIMEOUT_MS',
];

const USAGE_URL = 'https://tokens-usage-stg.example.run.app';

async function withEnvAndFetch<T>(
    overrides: Record<string, string | undefined>,
    fetchImpl: typeof fetch,
    fn: () => Effect.Effect<T, unknown>,
): Promise<T> {
    const savedEnv: Record<string, string | undefined> = {};
    for (const k of ENV_KEYS) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
    }
    for (const [k, v] of Object.entries(overrides)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    const savedFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    __resetCloudRunClientForTesting();
    try {
        return await Effect.runPromise(fn());
    } finally {
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        globalThis.fetch = savedFetch;
        __resetCloudRunClientForTesting();
    }
}

const CLOUDRUN_ENV = {
    TOKENS_CLOUDRUN_AUTH_TOKEN: 'secret-token',
    TOKENS_CLOUDRUN_ASSETS_URL: 'https://a.example.run.app',
    TOKENS_CLOUDRUN_PRICES_URL: 'https://p.example.run.app',
    TOKENS_CLOUDRUN_USAGE_URL: USAGE_URL,
};

describe('cloudrun/platformAuth.authenticateApiKey', () => {
    it('routes to the usage service', async () => {
        let capturedUrl = '';
        let capturedAuth = '';
        let capturedBody = '';
        const payload = {
            apiKeyId: 'key_1',
            keyPrefix: 'tk_live_abc',
            projectId: 'proj_1',
            ownerClerkUserId: 'user_1',
            scopes: ['assets:read'],
        };
        const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
            capturedUrl = String(input);
            capturedAuth = String((init.headers as Record<string, string>).authorization);
            capturedBody = String(init.body);
            return new Response(JSON.stringify(payload), { status: 200 });
        }) as unknown as typeof fetch;

        const keyHash = 'a'.repeat(64);
        const result = await withEnvAndFetch(CLOUDRUN_ENV, fetchImpl, () => authenticateApiKey(keyHash));

        expect(capturedUrl).toBe(`${USAGE_URL}/query/apiKeysAuthenticate`);
        expect(capturedAuth).toBe('Bearer secret-token');
        expect(JSON.parse(capturedBody)).toEqual({ keyHash });
        expect(result).toEqual(payload);
    });

    it('propagates null for unknown keys', async () => {
        const fetchImpl = (async () => new Response('null', { status: 200 })) as unknown as typeof fetch;
        const result = await withEnvAndFetch(CLOUDRUN_ENV, fetchImpl, () => authenticateApiKey('b'.repeat(64)));
        expect(result).toBeNull();
    });
});

describe('cloudrun/platformAuth.logApiRequest', () => {
    it('posts the mutation to the usage service', async () => {
        let capturedUrl = '';
        let capturedBody = '';
        const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
            capturedUrl = String(input);
            capturedBody = String(init.body);
            return new Response('null', { status: 200 });
        }) as unknown as typeof fetch;

        const args = {
            projectId: 'proj_1',
            apiKeyId: 'key_1',
            keyPrefix: 'tk_live_abc',
            method: 'GET',
            path: '/api/v1/assets/bonk',
            endpoint: '/api/v1/assets/:assetId',
            status: 200,
            latencyMs: 42,
            ts: 1_750_000_000_000,
        };
        await withEnvAndFetch(CLOUDRUN_ENV, fetchImpl, () => logApiRequest(args));

        expect(capturedUrl).toBe(`${USAGE_URL}/mutation/logApiRequest`);
        expect(JSON.parse(capturedBody)).toEqual(args);
    });
});
