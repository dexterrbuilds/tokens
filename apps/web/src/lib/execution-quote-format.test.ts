import { describe, expect, it } from 'bun:test';

import { formatPriceImpactRatio, fullPriceImpactRatio } from './execution-quote-format';

describe('Jupiter price impact formatting', () => {
    it('converts Jupiter decimal ratios into percentages', () => {
        expect(formatPriceImpactRatio(0.9846457765382045)).toBe('98.46%');
        expect(formatPriceImpactRatio(0.000244)).toBe('0.024%');
        expect(fullPriceImpactRatio(0.9846457765382045)).toBe('98.46457765382046%');
    });

    it('handles tiny and unavailable impacts', () => {
        expect(formatPriceImpactRatio(0.000001)).toBe('<0.001%');
        expect(formatPriceImpactRatio(null)).toBe('—');
    });
});
