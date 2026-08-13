import { describe, expect, it } from 'bun:test';

import { Effect } from 'effect';

import { __resetCloudRunClientForTesting } from './client';
import { CloudRunHttpError, CloudRunTimeoutError } from './errors';
import { getByAssetId } from './assets';

const ENV_KEYS = [
    'TOKENS_CLOUDRUN_AUTH_TOKEN',
    'TOKENS_CLOUDRUN_ASSETS_URL',
    'TOKENS_CLOUDRUN_PRICES_URL',
    'TOKENS_CLOUDRUN_USAGE_URL',
    'TOKENS_CLOUDRUN_ADMIN_URL',
    'TOKENS_CLOUDRUN_TIMEOUT_MS',
];

const ASSETS_URL = 'https://tokens-assets-stg.example.run.app';

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
    TOKENS_CLOUDRUN_ASSETS_URL: ASSETS_URL,
    TOKENS_CLOUDRUN_PRICES_URL: 'https://p.example.run.app',
    TOKENS_CLOUDRUN_USAGE_URL: 'https://u.example.run.app',
    TOKENS_CLOUDRUN_ADMIN_URL: 'https://a.example.run.app',
};

describe('cloudrun/assets.getByAssetId', () => {
    it('routes through CloudRunClient', async () => {
        let capturedUrl = '';
        let capturedAuth = '';
        let capturedBody = '';
        const payload = {
            assetId: 'bonk',
            category: 'crypto',
            aliases: ['bonk'],
            isActive: true,
            createdAt: 1,
            updatedAt: 2,
            symbol: 'BONK',
        };
        const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
            capturedUrl = String(input);
            capturedAuth = String((init.headers as Record<string, string>).authorization);
            capturedBody = String(init.body);
            return new Response(JSON.stringify(payload), { status: 200 });
        }) as unknown as typeof fetch;

        const result = (await withEnvAndFetch(CLOUDRUN_ENV, fetchImpl, () =>
            getByAssetId({ assetId: 'bonk' }),
        )) as { assetId: string; symbol: string } | null;

        expect(capturedUrl).toBe(`${ASSETS_URL}/query/getByAssetId`);
        expect(capturedAuth).toBe('Bearer secret-token');
        const parsed = JSON.parse(capturedBody) as { assetId: string; includeInactive?: boolean };
        expect(parsed.assetId).toBe('bonk');
        expect(parsed.includeInactive).toBe(undefined);
        expect(result?.assetId).toBe('bonk');
        expect(result?.symbol).toBe('BONK');
    });

    it('forwards includeInactive when set', async () => {
        let capturedBody = '';
        const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
            capturedBody = String(init.body);
            return new Response('null', { status: 200 });
        }) as unknown as typeof fetch;

        const result = await withEnvAndFetch(CLOUDRUN_ENV, fetchImpl, () =>
            getByAssetId({ assetId: 'sol', includeInactive: true }),
        );
        expect(result).toBe(null);
        const parsed = JSON.parse(capturedBody) as { assetId: string; includeInactive?: boolean };
        expect(parsed.assetId).toBe('sol');
        expect(parsed.includeInactive).toBe(true);
    });

    it('returns null when Cloud Run responds null', async () => {
        const fetchImpl = (async () => new Response('null', { status: 200 })) as unknown as typeof fetch;
        const result = await withEnvAndFetch(CLOUDRUN_ENV, fetchImpl, () => getByAssetId({ assetId: 'missing' }));
        expect(result).toBe(null);
    });

    it('propagates CloudRunHttpError on HTTP 5xx from Cloud Run', async () => {
        const fetchImpl = (async () =>
            new Response('upstream pg pool exhausted', { status: 500 })) as unknown as typeof fetch;
        let captured: unknown = null;
        try {
            await withEnvAndFetch(CLOUDRUN_ENV, fetchImpl, () => getByAssetId({ assetId: 'bonk' }));
        } catch (err) {
            captured = err;
        }
        expect(captured instanceof CloudRunHttpError).toBe(true);
        const callErr = captured as CloudRunHttpError;
        expect(callErr.service).toBe('assets');
        expect(callErr.kind).toBe('query');
        expect(callErr.callName).toBe('getByAssetId');
        expect(callErr.status).toBe(500);
    });

    it('propagates CloudRunTimeoutError on request timeout', async () => {
        const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
            await new Promise<void>((resolve, reject) => {
                init.signal?.addEventListener('abort', () => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            });
            return new Response('never', { status: 200 });
        }) as unknown as typeof fetch;
        let captured: unknown = null;
        try {
            await withEnvAndFetch(
                { ...CLOUDRUN_ENV, TOKENS_CLOUDRUN_TIMEOUT_MS: '10' },
                fetchImpl,
                () => getByAssetId({ assetId: 'bonk' }),
            );
        } catch (err) {
            captured = err;
        }
        expect(captured instanceof CloudRunTimeoutError).toBe(true);
        expect((captured as CloudRunTimeoutError).timeoutMs).toBe(10);
    });
});
