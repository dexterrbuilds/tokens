import { describe, expect, it } from 'bun:test';

import { depthSampleMints, executionQuotesLive, type LiveQuoteDeps } from './liveQuotes';
import type { DepthQuote, DepthQuoteClient } from './crons.depth';

const MINT_A = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij';
const MINT_B = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh';

function deps(handler: (args: { outputMint: string; amount: number }) => Promise<DepthQuote | null>): LiveQuoteDeps {
    const quoteSource: DepthQuoteClient = {
        id: 'jupiter_lite',
        async fetchQuote(args) {
            return handler({ outputMint: args.outputMint, amount: args.amount });
        },
        async close() {},
    };
    return { quoteSource, now: () => 1_700_000_000_000 };
}

// 1% worse effective price per extra $1M of size.
function syntheticQuote(amount: number): DepthQuote {
    const sizeUsd = amount / 1_000_000;
    return { inAmount: amount, outAmount: amount * (1 - 0.01 * (sizeUsd / 1_000_000)), routeVenues: [] };
}

describe('executionQuotesLive', () => {
    it('validates args', async () => {
        const d = deps(async () => null);
        await expect(executionQuotesLive(d, null)).rejects.toThrow('args must be an object');
        await expect(executionQuotesLive(d, { mints: 'x' })).rejects.toThrow('mints must be an array');
        await expect(executionQuotesLive(d, { mints: [MINT_A], amountUsd: 'x' })).rejects.toThrow(
            'amountUsd must be a finite number',
        );
    });

    it('measures impact against a same-instant baseline quote', async () => {
        const d = deps(async ({ amount }) => syntheticQuote(amount));
        const result = await executionQuotesLive(d, { mints: [MINT_A, MINT_B], amountUsd: 1_000_000 });
        expect(result.source).toBe('jupiter_lite');
        expect(result.baselineSizeUsd).toBe(10_000);
        expect(result.asOf).toBe(1_700_000_000);
        expect(result.entries).toHaveLength(2);
        // Synthetic curve: ~1% at $1M vs ~0.01% at $10k baseline → ~99bps.
        for (const entry of result.entries) {
            expect(entry.impactBps).toBeGreaterThan(90);
            expect(entry.impactBps).toBeLessThan(105);
        }
    });

    it('reads ~zero impact at or below the baseline size', async () => {
        const d = deps(async ({ amount }) => syntheticQuote(amount));
        const result = await executionQuotesLive(d, { mints: [MINT_A], amountUsd: 5_000 });
        expect(result.entries[0]?.impactBps).toBe(0);
    });

    it('degrades per mint on failure without failing the batch', async () => {
        const d = deps(async ({ outputMint, amount }) => {
            if (outputMint === MINT_A) throw new Error('connection reset');
            return syntheticQuote(amount);
        });
        const result = await executionQuotesLive(d, { mints: [MINT_A, MINT_B], amountUsd: 1_000_000 });
        expect(result.entries.find(e => e.mint === MINT_A)?.impactBps).toBeNull();
        expect(result.entries.find(e => e.mint === MINT_B)?.impactBps).not.toBeNull();
    });

    it('nulls impact when the pair is untradable (null quote)', async () => {
        const d = deps(async () => null);
        const result = await executionQuotesLive(d, { mints: [MINT_A], amountUsd: 1_000_000 });
        expect(result.entries[0]?.impactBps).toBeNull();
    });

    it('caps and dedupes mints, and clamps the amount', async () => {
        const seen = new Set<string>();
        const d = deps(async ({ outputMint, amount }) => {
            seen.add(outputMint);
            expect(amount).toBeLessThanOrEqual(50_000_000 * 1_000_000);
            return syntheticQuote(amount);
        });
        const mints = Array.from({ length: 12 }, (_, i) => `${MINT_A.slice(0, -2)}${String(i).padStart(2, '0')}`);
        const result = await executionQuotesLive(d, { mints: [...mints, mints[0]!], amountUsd: 99_000_000 });
        expect(result.entries).toHaveLength(8);
        expect(result.amountUsd).toBe(50_000_000);
        expect(seen.size).toBe(8);
    });
});

describe('depthSampleMints', () => {
    function sampleDeps(args: {
        handler: (a: { outputMint: string; amount: number }) => Promise<DepthQuote | null>;
        existing?: Array<{ mint: string; lastComputedAt: number }>;
    }) {
        const upserts: Array<{ mint: string; points: number }> = [];
        const quoteSource: DepthQuoteClient = {
            id: 'jupiter_lite',
            async fetchQuote(q) {
                return args.handler({ outputMint: q.outputMint, amount: q.amount });
            },
            async close() {},
        };
        const deps = {
            quoteSource,
            curvesRepo: {
                async selectStalestDepthMints() {
                    return [];
                },
                async upsertVariantDepthCurve(row: { mint: string; points: number }) {
                    upserts.push({ mint: row.mint, points: row.points });
                },
            },
            readsRepo: {
                async findLatestByMints() {
                    return (args.existing ?? []).map(row => ({
                        mint: row.mint,
                        quote_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                        side: 'buy',
                        source: 'jupiter_lite',
                        ladder: [],
                        points: 0,
                        failed_points: 0,
                        as_of: 0,
                        last_computed_at: row.lastComputedAt,
                    }));
                },
            },
            now: () => 1_700_000_000_000,
        };
        return { deps: deps as never, upserts };
    }

    it('samples uncovered mints and persists curves', async () => {
        const { deps, upserts } = sampleDeps({ handler: async ({ amount }) => syntheticQuote(amount) });
        const result = await depthSampleMints(deps, { mints: [MINT_A, MINT_B] });
        expect(result.sampled.sort()).toEqual([MINT_A, MINT_B].sort());
        expect(upserts).toHaveLength(2);
        expect(upserts[0]?.points).toBe(4);
    });

    it('skips mints sampled within the min-age window', async () => {
        const { deps, upserts } = sampleDeps({
            handler: async ({ amount }) => syntheticQuote(amount),
            existing: [{ mint: MINT_A, lastComputedAt: 1_700_000_000_000 - 60_000 }],
        });
        const result = await depthSampleMints(deps, { mints: [MINT_A, MINT_B] });
        expect(result.skippedFresh).toEqual([MINT_A]);
        expect(result.sampled).toEqual([MINT_B]);
        expect(upserts).toHaveLength(1);
    });

    it('persists an empty ladder for untradable mints and caps at 4', async () => {
        const { deps, upserts } = sampleDeps({ handler: async () => null });
        const mints = Array.from({ length: 6 }, (_, i) => `${MINT_A.slice(0, -2)}${String(i).padStart(2, '0')}`);
        const result = await depthSampleMints(deps, { mints });
        expect(result.sampled).toHaveLength(4);
        expect(upserts.every(row => row.points === 0)).toBe(true);
    });

    it('reports transport failures per mint without failing the batch', async () => {
        const { deps, upserts } = sampleDeps({
            handler: async ({ outputMint, amount }) => {
                if (outputMint === MINT_A) throw new Error('connection reset');
                return syntheticQuote(amount);
            },
        });
        const result = await depthSampleMints(deps, { mints: [MINT_A, MINT_B] });
        expect(result.failed).toEqual([MINT_A]);
        expect(result.sampled).toEqual([MINT_B]);
        expect(upserts).toHaveLength(1);
    });
});
