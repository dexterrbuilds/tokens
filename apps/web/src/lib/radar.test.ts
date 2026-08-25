import { describe, expect, test } from 'bun:test';

import { computeRadarScore, createRadarSnapshot, getVolumeAccelerationRatio } from './radar';
import type { Token } from './types';

const CB_BTC = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij';

function token(overrides: Partial<Token> = {}): Token {
    return {
        assetId: 'bitcoin',
        address: CB_BTC,
        name: 'Coinbase Wrapped BTC',
        symbol: 'cbBTC',
        decimals: 8,
        price: 100_000,
        priceChange24hPercent: 2,
        priceChange1hPercent: 1,
        liquidity: 10_000_000,
        volume1hUSD: 2_000_000,
        volume24hUSD: 12_000_000,
        trade1h: 2_000,
        trade24h: 15_000,
        uniqueWallet1h: 500,
        uniqueWallet24h: 3_000,
        marketCap: 0,
        lastTradeAt: 1_700_000_000,
        ...overrides,
    };
}

describe('Token Radar methodology', () => {
    test('computes volume pace against the asset own 24h hourly baseline', () => {
        expect(getVolumeAccelerationRatio(token())).toBe(4);
    });

    test('is deterministic and bounded', () => {
        const first = computeRadarScore(token());
        const second = computeRadarScore(token());
        expect(first).toEqual(second);
        expect(first.score >= 0).toBe(true);
        expect(first.score <= 100).toBe(true);
        expect(first.tier).toBe('tier2');
        expect(first.components.trust).toBe(68);
    });

    test('emits only threshold-backed snapshot signals', () => {
        const snapshot = createRadarSnapshot([token()]);
        expect(snapshot.signals.map(signal => signal.label)).toEqual(['Volume spike', 'Positive momentum']);
        expect(snapshot.signals.some(signal => signal.label.toLowerCase().includes('liquidity'))).toBe(false);
    });

    test('keeps one highest-activity representation per canonical asset', () => {
        const snapshot = createRadarSnapshot([
            token({ address: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', volume1hUSD: 1_000 }),
            token(),
        ]);
        expect(snapshot.assets).toHaveLength(1);
        expect(snapshot.assets[0]?.address).toBe(CB_BTC);
    });
});
