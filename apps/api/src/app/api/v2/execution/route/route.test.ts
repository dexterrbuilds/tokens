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

const CBBTC_MINT = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij';
const WBTC_MINT = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh';

function marketRow(mint: string, liquidity: number, volume24hUSD: number) {
    return {
        mint,
        market: {
            mint,
            source: 'birdeye',
            liquidity,
            volume24hUSD,
            trade24h: 5_000,
            lastFetchedAt: Date.now(),
        },
    };
}

function fillQualityRow(mint: string, executionScore: number) {
    return {
        mint,
        fillQuality: {
            source: 'clickhouse_fill_quality',
            quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            volume24hUSD: 1_000_000,
            trade24h: 2_000,
            botVolumeRatio: 0.1,
            feeBps: 3,
            flowSourceCount: 5,
            executionScore,
            isEligibleForPrimary: true,
            asOf: Math.floor(Date.now() / 1000),
            lastComputedAt: Date.now(),
        },
    };
}

function depthCurveRow(mint: string, asOfSecondsAgo: number) {
    const asOf = Math.floor(Date.now() / 1000) - asOfSecondsAgo;
    return {
        mint,
        depthCurve: {
            mint,
            quoteMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            side: 'buy',
            source: 'titan',
            ladder: [
                { sizeUsd: 10_000, inAmount: 1, outAmount: 1, priceImpactBps: 0, effectivePrice: 1, routeVenues: [] },
                { sizeUsd: 100_000, inAmount: 1, outAmount: 1, priceImpactBps: 10, effectivePrice: 1, routeVenues: [] },
                { sizeUsd: 1_000_000, inAmount: 1, outAmount: 1, priceImpactBps: 40, effectivePrice: 1, routeVenues: [] },
                { sizeUsd: 5_000_000, inAmount: 1, outAmount: 1, priceImpactBps: 120, effectivePrice: 1, routeVenues: [] },
            ],
            points: 4,
            failedPoints: 0,
            asOf,
            lastComputedAt: asOf * 1000,
        },
    };
}

let depthResponder: (() => unknown) | null = null;

function stubCloudRun(): void {
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/query/listDeletedRefs')) {
            return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url.includes('/query/variantDepthCurvesGetLatestByMints')) {
            if (!depthResponder) throw new Error('depth query not stubbed');
            return new Response(JSON.stringify(depthResponder()), { status: 200 });
        }
        if (url.includes('/query/variantMarketsGetLatestByMints')) {
            return new Response(
                JSON.stringify([marketRow(CBBTC_MINT, 40_000_000, 9_000_000), marketRow(WBTC_MINT, 5_000_000, 800_000)]),
                { status: 200 },
            );
        }
        if (url.includes('/query/variantFillQualityGetLatestByMints')) {
            return new Response(
                JSON.stringify([fillQualityRow(CBBTC_MINT, 80), fillQualityRow(WBTC_MINT, 55)]),
                { status: 200 },
            );
        }
        if (url.includes('/query/sanctumResolveRef')) {
            return new Response('null', { status: 200 });
        }
        if (url.includes('/query/resolveAssetRefForApi')) {
            return new Response('null', { status: 200 });
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
    depthResponder = null;
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

describe('GET /api/v2/execution/route', () => {
    it('ranks bitcoin variants and recommends the top candidate as primary', async () => {
        const response = await request('/api/v2/execution/route?asset=bitcoin');
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, max-age=60');

        const body = await response.json();
        expect(body.asset.assetId).toBe('bitcoin');
        expect(body.side).toBe('buy');
        expect(body.amountUsd).toBeNull();
        expect(body.primary?.mint).toBe(CBBTC_MINT);
        expect(body.variants.length).toBeGreaterThan(1);
        expect(body.variants[0].mint).toBe(CBBTC_MINT);
        expect(body.variants[0].rank).toBe(1);
        expect(Array.isArray(body.variants[0].reasons)).toBe(true);
        expect(body.variants[0].liquidityUsd).toBe(40_000_000);
        expect(body.variants[0].executionScore).toBe(80);
        expect(body.variants[0].isFillQualityEligible).toBe(true);
        expect(body.variants[0].estimatedImpactBps).toBeNull();
        expect(body.variants[0].sizeAwareScore).toBeNull();
        expect(body.meta.scoringVersion).toBe('fill-quality-24h-5s-v1');
        expect(body.meta.strategy).toBe('execution_quality');
        expect(body.meta.sizeAwareScoringVersion).toBeNull();
        expect(body.meta.depthSource).toBeNull();
        expect(body.meta.depthCoverage).toBeNull();

        // Ranks are contiguous and every variant appears exactly once.
        const mints = body.variants.map((entry: { mint: string }) => entry.mint);
        expect(new Set(mints).size).toBe(mints.length);
        expect(body.variants.map((entry: { rank: number }) => entry.rank)).toEqual(
            body.variants.map((_: unknown, index: number) => index + 1),
        );
    });

    it('populates informational depth fields from a fresh curve without reordering', async () => {
        depthResponder = () => [depthCurveRow(CBBTC_MINT, 60)];
        const response = await request('/api/v2/execution/route?asset=bitcoin&amountUsd=1000000');
        expect(response.status).toBe(200);
        const body = await response.json();

        const top = body.variants[0];
        expect(top.mint).toBe(CBBTC_MINT); // ordering unchanged (informational-only)
        expect(top.estimatedImpactBps).toBe(40);
        expect(top.estimatedOutUsd).toBe(996_000);
        expect(top.sizeAwareScore).not.toBeNull();
        expect(top.depthAsOf).toBeGreaterThan(0);
        expect(top.reasons).not.toContain('depth_unavailable');

        const second = body.variants[1];
        expect(second.estimatedImpactBps).toBeNull();
        expect(second.reasons).toContain('depth_unavailable');

        expect(body.meta.depthSource).toBe('titan');
        expect(body.meta.sizeLadderUsd).toEqual([10_000, 100_000, 1_000_000, 5_000_000]);
        expect(body.meta.depthCoverage.withCurves).toBe(1);
        expect(body.meta.sizeAwareScoringVersion).toBeNull(); // informational phase
        expect(body.meta.strategy).toBe('execution_quality');
    });

    it('flags extrapolation above the sampled ladder', async () => {
        depthResponder = () => [depthCurveRow(CBBTC_MINT, 60)];
        const response = await request('/api/v2/execution/route?asset=bitcoin&amountUsd=20000000');
        const body = await response.json();
        const top = body.variants[0];
        expect(top.estimatedImpactBps).toBe(120);
        expect(top.reasons).toContain('beyond_sampled_depth');
    });

    it('treats stale curves as absent', async () => {
        depthResponder = () => [depthCurveRow(CBBTC_MINT, 7 * 60 * 60)];
        const response = await request('/api/v2/execution/route?asset=bitcoin&amountUsd=1000000');
        const body = await response.json();
        expect(body.variants[0].estimatedImpactBps).toBeNull();
        expect(body.variants[0].reasons).toContain('depth_unavailable');
        expect(body.meta.depthCoverage.withCurves).toBe(0);
        expect(body.meta.depthSource).toBeNull();
    });

    it('degrades to depth_unavailable when the depth read fails', async () => {
        depthResponder = () => {
            throw new Error('depth read down');
        };
        const response = await request('/api/v2/execution/route?asset=bitcoin&amountUsd=1000000');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.variants[0].estimatedImpactBps).toBeNull();
        expect(body.variants[0].reasons).toContain('depth_unavailable');
    });

    it('marks every variant depth_unavailable when amountUsd is given (Phase A)', async () => {
        const response = await request('/api/v2/execution/route?asset=bitcoin&amountUsd=1000000');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.amountUsd).toBe(1_000_000);
        expect(body.meta.depthCoverage).toEqual({ withCurves: 0, total: body.variants.length });
        for (const entry of body.variants) {
            expect(entry.reasons).toContain('depth_unavailable');
            expect(entry.estimatedImpactBps).toBeNull();
        }
    });

    it('clamps amountUsd to the supported range', async () => {
        const response = await request('/api/v2/execution/route?asset=bitcoin&amountUsd=999999999');
        const body = await response.json();
        expect(body.amountUsd).toBe(50_000_000);
    });

    it('accepts side=sell and defaults side to buy', async () => {
        const sell = await request('/api/v2/execution/route?asset=bitcoin&side=sell');
        expect((await sell.json()).side).toBe('sell');

        const invalid = await request('/api/v2/execution/route?asset=bitcoin&side=hold');
        expect(invalid.status).toBe(400);
    });

    it('rejects a non-positive amountUsd', async () => {
        const response = await request('/api/v2/execution/route?asset=bitcoin&amountUsd=-5');
        expect(response.status).toBe(400);
    });

    it('requires the asset param', async () => {
        const response = await request('/api/v2/execution/route');
        expect(response.status).toBe(400);
    });

    it('404s for an unknown asset', async () => {
        const response = await request('/api/v2/execution/route?asset=not-a-real-asset');
        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error._tag).toBe('NotFoundError');
    });

    it('403s without the execution:read scope', async () => {
        const response = await request('/api/v2/execution/route?asset=bitcoin', ['assets:read']);
        expect(response.status).toBe(403);
    });
});
