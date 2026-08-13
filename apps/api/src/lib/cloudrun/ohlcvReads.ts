import type {
    OhlcvCandleResult,
    OhlcvBoundsResult as HandlerOhlcvBoundsResult,
} from '../../../../cloudrun-assets/src/handlers/ohlcvReads';

import { sanitizeOhlcvWicks } from '../ohlcv-sanitize';
import { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type OhlcvListArgs = {
    address: string;
    interval: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W';
    from?: number;
    to?: number;
    limit?: number;
};
export type OhlcvListResult = OhlcvCandleResult[];

export function ohlcvList(args: OhlcvListArgs): Effect.Effect<OhlcvListResult, CloudRunError> {
    return cloudRunQuery<OhlcvListResult>('assets', 'ohlcvList', { ...args }).pipe(
        // On-chain candles aggregate raw swaps across all pools; dust trades in
        // illiquid pools poison high/low (see ohlcv-sanitize.ts).
        Effect.map(candles => sanitizeOhlcvWicks(candles)),
    );
}

export type OhlcvBoundsArgs = {
    address: string;
    interval: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W';
};
export type OhlcvBoundsResult = HandlerOhlcvBoundsResult;

export function ohlcvBounds(args: OhlcvBoundsArgs): Effect.Effect<OhlcvBoundsResult, CloudRunError> {
    return cloudRunQuery<OhlcvBoundsResult>('assets', 'ohlcvBounds', { ...args });
}

export type StockOhlcvListArgs = {
    assetId: string;
    interval: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W';
    from?: number;
    to?: number;
    limit?: number;
};
export type StockOhlcvListResult = OhlcvCandleResult[];

export function stockOhlcvList(args: StockOhlcvListArgs): Effect.Effect<StockOhlcvListResult, CloudRunError> {
    return cloudRunQuery<StockOhlcvListResult>('assets', 'stockOhlcvList', { ...args });
}
