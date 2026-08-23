import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('server-only', () => ({}));

const { __resetCloudRunClientForTesting } = await import('@/lib/cloudrun/client');
const { resetEnvForTests } = await import('@/lib/env');
const { signPlaygroundProxyAuthPayload } = await import('@/effect/playground-proxy-auth');
const { GET: routeGet } = await import('./route');

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_LOG = console.log;
const ORIGINAL_WARN = console.warn;
const ORIGINAL_ERROR = console.error;
const ENV_KEYS = [
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

const MINT = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
let quoteArgs: Record<string, unknown> | null = null;
let tokenExists = true;
let tokenDecimals: number | null = 8;
let marketMetadataExists = false;
let marketDecimals: number | null = 8;
let jupiterMetadataExists = false;
let quoteResponder: (() => unknown) | null = null;

function availableEntry(amount: string, rawAmount: string) {
    const candidate = {
        provider: 'jupiter',
        status: 'available',
        inAmountRaw: rawAmount,
        outAmountRaw: '123456789012345678',
        priceImpactPct: 0.42,
        route: [
            {
                ammKey: 'amm',
                label: 'Meteora DLMM',
                percent: 100,
                inputMint: USDC,
                outputMint: MINT,
                inAmountRaw: rawAmount,
                outAmountRaw: '123456789012345678',
                feeAmountRaw: '10',
                feeMint: USDC,
            },
        ],
        contextSlot: 123,
        quotedAt: '2026-08-22T12:34:56.000Z',
    } as const;
    return {
        request: { unit: 'usd', amount, rawAmount },
        status: 'available',
        provider: 'jupiter',
        inAmountRaw: rawAmount,
        outAmountRaw: '123456789012345678',
        priceImpactPct: 0.42,
        route: [
            {
                ammKey: 'amm',
                label: 'Meteora DLMM',
                percent: 100,
                inputMint: USDC,
                outputMint: MINT,
                inAmountRaw: rawAmount,
                outAmountRaw: '123456789012345678',
                feeAmountRaw: '10',
                feeMint: USDC,
            },
        ],
        contextSlot: 123,
        quotedAt: '2026-08-22T12:34:56.000Z',
        candidates: [
            candidate,
            {
                provider: 'titan',
                status: 'unavailable',
                reason: 'quote_unavailable',
                inAmountRaw: null,
                outAmountRaw: null,
                priceImpactPct: null,
                route: [],
                contextSlot: null,
                quotedAt: '2026-08-22T12:34:56.000Z',
            },
        ],
    };
}

function defaultQuoteResponse() {
    return {
        providers: ['jupiter', 'titan'],
        mint: MINT,
        side: 'buy',
        quoteMint: USDC,
        entries: [availableEntry('10000', '10000000000')],
    };
}

function stubCloudRun(): void {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/query/listDeletedRefs')) return Response.json([]);
        if (url.includes('/query/tokensGetByAddress')) {
            return Response.json(
                tokenExists
                    ? {
                          _id: 'token',
                          _creationTime: 1,
                          address: MINT,
                          symbol: 'cbBTC',
                          name: 'Coinbase Wrapped BTC',
                          decimals: tokenDecimals,
                          lastFetchedAt: 1,
                      }
                    : null,
            );
        }
        if (url.includes('/query/variantMarketsGetLatestByMints')) {
            return Response.json([
                {
                    mint: MINT,
                    market: marketMetadataExists
                        ? {
                              mint: MINT,
                              source: 'birdeye',
                              symbol: 'cbBTC',
                              name: 'Coinbase Wrapped BTC',
                              decimals: marketDecimals,
                              lastFetchedAt: 1,
                          }
                        : null,
                },
            ]);
        }
        if (url.includes('/query/executionQuoteTokenMetadata')) {
            return Response.json(
                jupiterMetadataExists
                    ? { mint: MINT, symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', decimals: 8 }
                    : null,
            );
        }
        if (url.includes('/query/executionQuotesLive')) {
            const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
            quoteArgs = rawBody ? (JSON.parse(String(rawBody)) as Record<string, unknown>) : null;
            return Response.json(quoteResponder?.() ?? defaultQuoteResponse());
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;
}

beforeEach(() => {
    for (const key of ENV_KEYS) {
        const value = process.env[key];
        if (value !== undefined) savedEnv[key] = value;
        else delete savedEnv[key];
        delete process.env[key];
    }
    process.env.TOKENS_CLOUDRUN_AUTH_TOKEN = 'cloudrun-token';
    process.env.TOKENS_CLOUDRUN_ASSETS_URL = 'https://assets.example.run.app';
    process.env.TOKENS_CLOUDRUN_PRICES_URL = 'https://prices.example.run.app';
    process.env.TOKENS_CLOUDRUN_USAGE_URL = 'https://usage.example.run.app';
    process.env.TOKENS_PLAYGROUND_PROXY_SECRET = 'test-playground-secret';
    process.env.TOKENS_USAGE_LOG_MODE = 'off';
    resetEnvForTests();
    __resetCloudRunClientForTesting();
    quoteArgs = null;
    tokenExists = true;
    tokenDecimals = 8;
    marketMetadataExists = false;
    marketDecimals = 8;
    jupiterMetadataExists = false;
    quoteResponder = null;
    stubCloudRun();
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

async function request(path: string, scopes: string[] = ['execution:read']): Promise<Response> {
    const now = Date.now();
    const header = await signPlaygroundProxyAuthPayload({
        apiKeyId: 'test-key',
        keyPrefix: 'tk_test',
        projectId: 'test-project',
        ownerClerkUserId: 'test-user',
        scopes,
        iat: now,
        exp: now + 60_000,
    });
    return routeGet(
        new Request(`https://api.example.test${path}`, { headers: { 'x-tokens-playground-auth': header } }),
        {} as never,
    );
}

describe('GET /api/v2/execution/evaluate', () => {
    it('returns exact Jupiter data for the selected mint with no-store caching', async () => {
        const response = await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=10000`);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(quoteArgs).toEqual({ mint: MINT, side: 'buy', amounts: ['10000'], tokenDecimals: 8 });

        const body = await response.json();
        expect({ mint: body.mint, side: body.side, providers: body.providers, token: body.token, meta: body.meta }).toEqual({
            mint: MINT,
            side: 'buy',
            providers: ['jupiter', 'titan'],
            token: { mint: MINT, symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', decimals: 8 },
            meta: {
                requested: 1,
                available: 1,
                unavailable: 0,
                providerStats: { jupiter: { available: 1, wins: 1 }, titan: { available: 0, wins: 0 } },
            },
        });
        expect({
            request: body.quotes[0].request,
            provider: body.quotes[0].provider,
            input: body.quotes[0].input,
            output: body.quotes[0].output,
            priceImpactPct: body.quotes[0].priceImpactPct,
            contextSlot: body.quotes[0].contextSlot,
            quotedAt: body.quotes[0].quotedAt,
        }).toEqual({
            request: { unit: 'usd', amount: '10000', rawAmount: '10000000000' },
            provider: 'jupiter',
            input: { mint: USDC, symbol: 'USDC', decimals: 6, amount: '10000', rawAmount: '10000000000' },
            output: {
                mint: MINT,
                symbol: 'cbBTC',
                decimals: 8,
                amount: '1234567890.12345678',
                rawAmount: '123456789012345678',
            },
            priceImpactPct: 0.42,
            contextSlot: 123,
            quotedAt: '2026-08-22T12:34:56.000Z',
        });
        expect(body.quotes[0].candidates.map((candidate: { provider: string; status: string }) => ({
            provider: candidate.provider,
            status: candidate.status,
        }))).toEqual([
            { provider: 'jupiter', status: 'available' },
            { provider: 'titan', status: 'unavailable' },
        ]);
    });

    it('serializes a Titan winner and mixed-provider statistics', async () => {
        const entry = availableEntry('25000', '25000000000');
        const titan = {
            ...entry.candidates[0],
            provider: 'titan',
            outAmountRaw: '123456789012345679',
            priceImpactPct: null,
            quotedAt: '2026-08-22T12:34:56.100Z',
        } as const;
        quoteResponder = () => ({
            providers: ['jupiter', 'titan'],
            mint: MINT,
            side: 'buy',
            quoteMint: USDC,
            entries: [
                {
                    ...entry,
                    provider: 'titan',
                    outAmountRaw: titan.outAmountRaw,
                    priceImpactPct: null,
                    quotedAt: titan.quotedAt,
                    candidates: [entry.candidates[0], titan],
                },
            ],
        });

        const body = await (await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=25000`)).json();
        expect({ provider: body.quotes[0].provider, priceImpactPct: body.quotes[0].priceImpactPct }).toEqual({
            provider: 'titan',
            priceImpactPct: null,
        });
        expect(body.quotes[0].output.rawAmount).toBe('123456789012345679');
        expect(body.quotes[0].candidates.map((candidate: { provider: string }) => candidate.provider)).toEqual([
            'jupiter',
            'titan',
        ]);
        expect(body.meta.providerStats).toEqual({
            jupiter: { available: 1, wins: 0 },
            titan: { available: 1, wins: 1 },
        });
    });

    it('accepts repeated buy amounts, normalizes and dedupes them', async () => {
        const response = await request(
            `/api/v2/execution/evaluate?mint=${MINT}&side=buy&amountUsd=10000&amountUsd=25000&amountUsd=10000.0`,
        );
        expect(response.status).toBe(200);
        expect(quoteArgs?.amounts).toEqual(['10000', '25000']);
    });

    it('supports exact token sells and reverses the formatted pair', async () => {
        quoteResponder = () => ({
            providers: ['jupiter', 'titan'],
            mint: MINT,
            side: 'sell',
            quoteMint: USDC,
            entries: [
                {
                    ...availableEntry('12.5', '1250000000'),
                    request: { unit: 'token', amount: '12.5', rawAmount: '1250000000' },
                    inAmountRaw: '1250000000',
                    outAmountRaw: '987654321',
                },
            ],
        });
        const response = await request(`/api/v2/execution/evaluate?mint=${MINT}&side=sell&tokenAmount=12.5`);
        expect(response.status).toBe(200);
        expect(quoteArgs).toEqual({ mint: MINT, side: 'sell', amounts: ['12.5'], tokenDecimals: 8 });
        const body = await response.json();
        expect({ mint: body.quotes[0].input.mint, symbol: body.quotes[0].input.symbol, amount: body.quotes[0].input.amount }).toEqual({ mint: MINT, symbol: 'cbBTC', amount: '12.5' });
        expect({ mint: body.quotes[0].output.mint, symbol: body.quotes[0].output.symbol, amount: body.quotes[0].output.amount }).toEqual({ mint: USDC, symbol: 'USDC', amount: '987.654321' });
    });

    it('preserves unavailable rows without substituting a quote', async () => {
        quoteResponder = () => ({
            providers: ['jupiter', 'titan'],
            mint: MINT,
            side: 'buy',
            quoteMint: USDC,
            entries: [
                {
                    request: { unit: 'usd', amount: '5000000', rawAmount: '5000000000000' },
                    status: 'unavailable',
                    reason: 'quote_unavailable',
                    provider: null,
                    inAmountRaw: null,
                    outAmountRaw: null,
                    priceImpactPct: null,
                    route: [],
                    contextSlot: null,
                    quotedAt: '2026-08-22T12:34:56.000Z',
                    candidates: [
                        {
                            provider: 'jupiter',
                            status: 'unavailable',
                            reason: 'quote_unavailable',
                            inAmountRaw: null,
                            outAmountRaw: null,
                            priceImpactPct: null,
                            route: [],
                            contextSlot: null,
                            quotedAt: '2026-08-22T12:34:56.000Z',
                        },
                        {
                            provider: 'titan',
                            status: 'unavailable',
                            reason: 'quote_unavailable',
                            inAmountRaw: null,
                            outAmountRaw: null,
                            priceImpactPct: null,
                            route: [],
                            contextSlot: null,
                            quotedAt: '2026-08-22T12:34:56.000Z',
                        },
                    ],
                },
            ],
        });
        const response = await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=5000000`);
        const body = await response.json();
        expect({ status: body.quotes[0].status, input: body.quotes[0].input, output: body.quotes[0].output }).toEqual({ status: 'unavailable', input: null, output: null });
        expect(body.meta).toEqual({
            requested: 1,
            available: 0,
            unavailable: 1,
            providerStats: { jupiter: { available: 0, wins: 0 }, titan: { available: 0, wins: 0 } },
        });
    });

    it('validates mint, side-specific amounts, precision, range, and batch size', async () => {
        expect((await request('/api/v2/execution/evaluate')).status).toBe(400);
        expect((await request('/api/v2/execution/evaluate?mint=bad&amountUsd=10')).status).toBe(400);
        expect((await request(`/api/v2/execution/evaluate?mint=${MINT}`)).status).toBe(400);
        expect((await request(`/api/v2/execution/evaluate?mint=${MINT}&side=buy&tokenAmount=1`)).status).toBe(400);
        expect((await request(`/api/v2/execution/evaluate?mint=${MINT}&side=sell&amountUsd=1`)).status).toBe(400);
        expect((await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=0.5`)).status).toBe(400);
        expect((await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=50000001`)).status).toBe(400);
        expect((await request(`/api/v2/execution/evaluate?mint=${MINT}&side=sell&tokenAmount=1.000000001`)).status).toBe(
            400,
        );
        const ten = Array.from({ length: 10 }, (_, index) => `amountUsd=${index + 1}`).join('&');
        expect((await request(`/api/v2/execution/evaluate?mint=${MINT}&${ten}`)).status).toBe(400);
    });

    it('returns 404 for unsupported token metadata', async () => {
        tokenExists = false;
        const response = await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=10000`);
        expect(response.status).toBe(404);
    });

    it('uses authoritative variant-market decimals when the token row is absent', async () => {
        tokenExists = false;
        marketMetadataExists = true;
        const response = await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=10000`);
        expect(response.status).toBe(200);
        expect(quoteArgs).toEqual({ mint: MINT, side: 'buy', amounts: ['10000'], tokenDecimals: 8 });
    });

    it('falls back to Jupiter token metadata when local rows omit decimals', async () => {
        tokenExists = false;
        marketMetadataExists = true;
        marketDecimals = null;
        jupiterMetadataExists = true;
        const response = await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=10000`);
        expect(response.status).toBe(200);
        expect(quoteArgs).toEqual({ mint: MINT, side: 'buy', amounts: ['10000'], tokenDecimals: 8 });
    });

    it('retains the execution:read scope', async () => {
        const response = await request(`/api/v2/execution/evaluate?mint=${MINT}&amountUsd=10000`, ['assets:read']);
        expect(response.status).toBe(403);
    });
});
