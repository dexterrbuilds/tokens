import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('server-only', () => ({}));

let requestScopedOidcToken: string | undefined;
mock.module('@vercel/oidc', () => ({
    getVercelOidcToken: () => requestScopedOidcToken,
}));

const { callCloudRun } = await import('./cloudrun');

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
    'GCP_WIF_AUDIENCE',
    'GCP_ADMIN_INVOKER_SA',
    'TOKENS_CLOUDRUN_ADMIN_URL',
    'TOKENS_CLOUDRUN_AUTH_TOKEN',
    'VERCEL_OIDC_TOKEN',
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

beforeEach(() => {
    for (const key of ENV_KEYS) {
        const value = process.env[key];
        if (value !== undefined) savedEnv[key] = value;
        delete process.env[key];
    }
    requestScopedOidcToken = undefined;
});

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    for (const key of ENV_KEYS) {
        const value = savedEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
        delete savedEnv[key];
    }
});

describe('callCloudRun Vercel OIDC auth', () => {
    it('exchanges the request-scoped token when no VERCEL_OIDC_TOKEN environment variable exists', async () => {
        process.env.GCP_WIF_AUDIENCE = '//iam.googleapis.com/projects/123/locations/global/pools/test/providers/vercel';
        process.env.GCP_ADMIN_INVOKER_SA = 'vercel-admin@example.iam.gserviceaccount.com';
        process.env.TOKENS_CLOUDRUN_ADMIN_URL = 'https://admin-oidc-test.example.run.app';
        requestScopedOidcToken = 'request-context-token';

        const requests: Array<{ init?: RequestInit; url: string }> = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            requests.push({ url, ...(init ? { init } : {}) });
            if (url === 'https://sts.googleapis.com/v1/token') {
                return Response.json({ access_token: 'federated-token' });
            }
            if (url.startsWith('https://iamcredentials.googleapis.com/')) {
                return Response.json({ token: 'google-id-token' });
            }
            return Response.json({ ok: true });
        }) as typeof fetch;

        await expect(
            callCloudRun('admin', 'query', 'listAssets', {}, { clerkUserId: 'user_123' }),
        ).resolves.toEqual({ ok: true });

        const stsBody = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
        expect(stsBody.subjectToken).toBe('request-context-token');
        expect(requests[1]?.init?.headers).toEqual({
            'content-type': 'application/json',
            authorization: 'Bearer federated-token',
        });
        expect(requests[2]?.init?.headers).toMatchObject({ authorization: 'Bearer google-id-token' });
    });
});
