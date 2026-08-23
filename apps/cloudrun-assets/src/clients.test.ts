import { describe, expect, test } from 'bun:test';

import { makeClickhouseClient, makeJupiterExactQuoteClient } from './clients';

const BASE_OPTS = {
    url: 'http://clickhouse.invalid',
    username: 'u',
    password: 'p',
    database: 'default',
    solanaTradesTable: 'trades_anza_final',
    tradingApiUrl: 'https://trading-api.test/v1/query',
} as const;

describe('fetchSolanaMintSnapshots (clickhouse-api gateway)', () => {
    test('posts the tokens_summary preset and maps rows + price change', async () => {
        const calls: Array<{ url: string; body: unknown }> = [];
        const fetchImpl = (async (url: string, init: RequestInit) => {
            calls.push({ url, body: JSON.parse(String(init.body)) });
            return new Response(
                JSON.stringify({
                    data: [
                        {
                            mint: 'MintA',
                            priceUsd: 110,
                            volume1hUsd: 5,
                            volume24hUsd: 20,
                            trade1h: 2,
                            trade24h: 8,
                            uniqueTrader1h: 1,
                            uniqueTrader24h: 4,
                            price1hAgo: 100,
                            price24hAgo: 50,
                            lastTradeAtMs: 1784018908299,
                        },
                    ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }) as unknown as typeof fetch;

        const client = makeClickhouseClient({ ...BASE_OPTS, fetchImpl });
        const out = await client.fetchSolanaMintSnapshots({
            mints: ['MintA'],
            stableMints: ['USDC'],
            asOfMs: 2_000_000,
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://trading-api.test/v1/query');
        expect(calls[0]?.body).toEqual({
            name: 'tokens_summary',
            params: { mints: ['MintA'], stables: ['USDC'] },
        });
        expect(out).toHaveLength(1);
        const s = out[0]!;
        expect(s.priceUsd).toBe(110);
        expect(s.volume24hUsd).toBe(20);
        expect(s.uniqueTrader24h).toBe(4);
        expect(s.priceChange1hPercent).toBeCloseTo(10); // (110-100)/100*100
        expect(s.priceChange24hPercent).toBeCloseTo(120); // (110-50)/50*100
        expect(s.lastTradeAt).toBe(1784018908299);
        expect(s.asOf).toBe(2000); // floor(asOfMs/1000)
    });

    test('leaves price change null when a reference price is missing', async () => {
        const fetchImpl = (async () =>
            new Response(JSON.stringify({ data: [{ mint: 'M', priceUsd: 1, price1hAgo: null }] }), {
                status: 200,
            })) as unknown as typeof fetch;
        const client = makeClickhouseClient({ ...BASE_OPTS, fetchImpl });
        const [s] = await client.fetchSolanaMintSnapshots({ mints: ['M'], stableMints: ['USDC'] });
        expect(s?.priceChange1hPercent).toBeNull();
        expect(s?.volume24hUsd).toBe(0);
        expect(s?.asOf).toBeNull();
    });

    test('throws on a non-ok gateway response', async () => {
        const fetchImpl = (async () => new Response('upstream boom', { status: 502 })) as unknown as typeof fetch;
        const client = makeClickhouseClient({ ...BASE_OPTS, fetchImpl });
        await expect(
            client.fetchSolanaMintSnapshots({ mints: ['M'], stableMints: ['USDC'] }),
        ).rejects.toThrow('clickhouse-api HTTP 502');
    });
});

describe('makeJupiterExactQuoteClient', () => {
    test('resolves exact token metadata from the Jupiter token index', async () => {
        const originalFetch = globalThis.fetch;
        let requestUrl = '';
        globalThis.fetch = (async (input: string | URL | Request) => {
            requestUrl = String(input);
            return Response.json([
                { id: 'another-mint', name: 'Other', symbol: 'OTHER', decimals: 9 },
                { id: 'TOKEN', name: 'Sandisk - Backpack Securities', symbol: 'SNDK', decimals: 6 },
            ]);
        }) as typeof fetch;
        try {
            const client = makeJupiterExactQuoteClient({ baseUrl: 'https://lite-api.jup.test' });
            expect(await client.fetchTokenMetadata('TOKEN')).toEqual({
                mint: 'TOKEN',
                name: 'Sandisk - Backpack Securities',
                symbol: 'SNDK',
                decimals: 6,
            });
            expect(requestUrl).toBe('https://lite-api.jup.test/tokens/v2/search?query=TOKEN');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('preserves raw amounts, provider impact, route plan, and pro authentication', async () => {
        const originalFetch = globalThis.fetch;
        let requestUrl = '';
        let requestHeaders = new Headers();
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            requestUrl = String(input);
            requestHeaders = new Headers(init?.headers);
            return Response.json({
                inAmount: '10000000000',
                outAmount: '123456789012345678',
                priceImpactPct: '0.42',
                contextSlot: 123456789,
                routePlan: [
                    {
                        percent: 100,
                        swapInfo: {
                            ammKey: 'amm',
                            label: 'Meteora DLMM',
                            inputMint: 'USDC',
                            outputMint: 'TOKEN',
                            inAmount: '10000000000',
                            outAmount: '123456789012345678',
                            feeAmount: '0',
                            feeMint: 'USDC',
                        },
                    },
                ],
            });
        }) as typeof fetch;
        try {
            const client = makeJupiterExactQuoteClient({ baseUrl: 'https://api.jup.test', apiKey: 'secret' });
            const quote = await client.fetchQuote({ inputMint: 'USDC', outputMint: 'TOKEN', amountRaw: '10000000000' });
            expect(requestUrl).toContain('amount=10000000000');
            expect(requestHeaders.get('x-api-key')).toBe('secret');
            expect(quote).toEqual({
                inAmountRaw: '10000000000',
                outAmountRaw: '123456789012345678',
                priceImpactPct: 0.42,
                contextSlot: 123456789,
                route: [
                    {
                        ammKey: 'amm',
                        label: 'Meteora DLMM',
                        percent: 100,
                        inputMint: 'USDC',
                        outputMint: 'TOKEN',
                        inAmountRaw: '10000000000',
                        outAmountRaw: '123456789012345678',
                        feeAmountRaw: '0',
                        feeMint: 'USDC',
                    },
                ],
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('degrades a Jupiter no-route response to null', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response('{"errorCode":"COULD_NOT_FIND_ANY_ROUTE"}', { status: 400 })) as unknown as typeof fetch;
        try {
            const client = makeJupiterExactQuoteClient({ baseUrl: 'https://lite-api.jup.test' });
            expect(await client.fetchQuote({ inputMint: 'USDC', outputMint: 'TOKEN', amountRaw: '1' })).toBeNull();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
