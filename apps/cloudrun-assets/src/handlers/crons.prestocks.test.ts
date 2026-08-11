import { describe, expect, test } from 'bun:test';

import { makePreStocksClient } from '../clients';
import {
    refreshPrestocksPrices,
    type PreStocksApiSnapshot,
    type PrestocksCronDeps,
    type PrestocksPriceUpsert,
} from './crons.prestocks';

const ANDURIL_MINT = 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB';
const KALSHI_MINT = 'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua';

function snapshot(overrides: Partial<PreStocksApiSnapshot> = {}): PreStocksApiSnapshot {
    return {
        symbol: 'ANDURIL',
        name: 'Anduril PreStocks',
        mint: ANDURIL_MINT,
        markPriceUsd: 132.81,
        markValuationUsd: 107_948_980_944,
        tokenPriceUsd: 174.01,
        impliedValuationUsd: 141_433_261_696,
        supply: 10_227.73,
        imageUrl: 'https://www.prestocks.com/logos/anduril.png',
        externalUrl: 'https://www.prestocks.com/anduril',
        ...overrides,
    };
}

function makeDeps(overrides: Partial<PrestocksCronDeps> = {}): {
    deps: PrestocksCronDeps;
    upserts: PrestocksPriceUpsert[];
} {
    const upserts: PrestocksPriceUpsert[] = [];
    const deps: PrestocksCronDeps = {
        prestocks: { async fetchBySymbol() { return snapshot(); } },
        repo: {
            async upsertLatest(row) {
                upserts.push(row);
            },
        },
        now: () => 1_786_406_400_000,
        listings: [{ mint: ANDURIL_MINT, symbol: 'ANDURIL', name: 'Anduril', assetId: 'pre-prestj4y' }],
        isRefreshEnabled: () => true,
        delayMs: 0,
        ...overrides,
    };
    return { deps, upserts };
}

describe('makePreStocksClient', () => {
    test('parses payloads with raw control characters in description', async () => {
        // prestocks.com returns literal newlines inside the description string,
        // which strict JSON.parse rejects.
        const body =
            '{"name":"Anduril PreStocks","symbol":"ANDURIL","description":"Line one.\n\nLine two.",' +
            `"image":"https://www.prestocks.com/logos/anduril.png","external_url":"https://www.prestocks.com/anduril",` +
            `"contract_address":"${ANDURIL_MINT}","markPrice":132.81263967,"markValuation":107948980944,` +
            '"tokenPrice":174.00928344776113,"impliedValuation":141433261696,"supply":10227.733822361}';
        const fetchImpl = (async () =>
            new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

        const client = makePreStocksClient({ fetchImpl });
        const out = await client.fetchBySymbol('ANDURIL');

        expect(out).not.toBeNull();
        expect(out?.symbol).toBe('ANDURIL');
        expect(out?.mint).toBe(ANDURIL_MINT);
        expect(out?.markPriceUsd).toBeCloseTo(132.81263967);
        expect(out?.markValuationUsd).toBe(107948980944);
        expect(out?.tokenPriceUsd).toBeCloseTo(174.00928344776113);
        expect(out?.impliedValuationUsd).toBe(141433261696);
        expect(out?.supply).toBeCloseTo(10227.733822361);
    });

    test('returns null on 404 (unknown symbol)', async () => {
        const fetchImpl = (async () =>
            new Response('{"error":"Token not found"}', { status: 404 })) as unknown as typeof fetch;
        const client = makePreStocksClient({ fetchImpl });
        expect(await client.fetchBySymbol('NOPE')).toBeNull();
    });

    test('rejects symbols that are not plain alphanumerics', async () => {
        const fetchImpl = (async () => {
            throw new Error('should not fetch');
        }) as unknown as typeof fetch;
        const client = makePreStocksClient({ fetchImpl });
        expect(await client.fetchBySymbol('../etc')).toBeNull();
    });

    test('throws on server errors', async () => {
        const fetchImpl = (async () => new Response('oops', { status: 500 })) as unknown as typeof fetch;
        const client = makePreStocksClient({ fetchImpl });
        await expect(client.fetchBySymbol('ANDURIL')).rejects.toThrow('PreStocks request failed');
    });
});

describe('refreshPrestocksPrices', () => {
    test('skips everything when the refresh flag is off', async () => {
        const { deps, upserts } = makeDeps({ isRefreshEnabled: () => false });
        const out = await refreshPrestocksPrices(deps, {});
        expect(out.disabled).toBe(true);
        expect(out.processed).toBe(0);
        expect(upserts).toHaveLength(0);
    });

    test('requireRefreshEnabled: false bypasses the flag', async () => {
        const { deps, upserts } = makeDeps({ isRefreshEnabled: () => false });
        const out = await refreshPrestocksPrices(deps, { requireRefreshEnabled: false });
        expect(out.disabled).toBe(false);
        expect(out.succeeded).toBe(1);
        expect(upserts).toHaveLength(1);
    });

    test('upserts snapshots stamped with lastFetchedAt', async () => {
        const { deps, upserts } = makeDeps();
        const out = await refreshPrestocksPrices(deps, {});
        expect(out.succeeded).toBe(1);
        expect(out.failed).toBe(0);
        expect(upserts).toHaveLength(1);
        expect(upserts[0]?.mint).toBe(ANDURIL_MINT);
        expect(upserts[0]?.lastFetchedAt).toBe(1_786_406_400_000);
    });

    test('does not upsert on fetch failure (keeps last snapshot)', async () => {
        const { deps, upserts } = makeDeps({
            prestocks: {
                async fetchBySymbol() {
                    throw new Error('provider down');
                },
            },
        });
        const out = await refreshPrestocksPrices(deps, {});
        expect(out.succeeded).toBe(0);
        expect(out.failed).toBe(1);
        expect(upserts).toHaveLength(0);
    });

    test('does not upsert when the returned mint mismatches the registry mint', async () => {
        const { deps, upserts } = makeDeps({
            prestocks: { async fetchBySymbol() { return snapshot({ mint: KALSHI_MINT }); } },
        });
        const out = await refreshPrestocksPrices(deps, {});
        expect(out.succeeded).toBe(0);
        expect(out.failed).toBe(1);
        expect(upserts).toHaveLength(0);
    });

    test('continues past per-symbol failures', async () => {
        const { deps, upserts } = makeDeps({
            listings: [
                { mint: KALSHI_MINT, symbol: 'KALSHI', name: 'Kalshi', assetId: 'pre-prelwgkk' },
                { mint: ANDURIL_MINT, symbol: 'ANDURIL', name: 'Anduril', assetId: 'pre-prestj4y' },
            ],
            prestocks: {
                async fetchBySymbol(symbol) {
                    if (symbol === 'KALSHI') throw new Error('boom');
                    return snapshot();
                },
            },
        });
        const out = await refreshPrestocksPrices(deps, {});
        expect(out.succeeded).toBe(1);
        expect(out.failed).toBe(1);
        expect(upserts).toHaveLength(1);
    });
});
