import type {
    TrendingListResult,
    FreshTrendingListResult,
} from '../../../../cloudrun-assets/src/handlers/trendingReads';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

type AssetCategory =
    | 'crypto'
    | 'stablecoin'
    | 'lst'
    | 'rwa'
    | 'commodity'
    | 'equity'
    | 'etf'
    | 'index';

export type TrendingMarketsListArgs = { category?: AssetCategory; limit?: number; offset?: number };
export type TrendingMarketsListResult = TrendingListResult;

export function trendingMarketsList(args: TrendingMarketsListArgs): Effect.Effect<TrendingMarketsListResult, CloudRunError> {
    return cloudRunQuery<TrendingMarketsListResult>('assets', 'trendingMarketsList', {
        ...args,
    });
}

export type FreshTrendingMarketsListArgs = TrendingMarketsListArgs;
export type FreshTrendingMarketsListResult = FreshTrendingListResult;

export function freshTrendingMarketsList(
    args: FreshTrendingMarketsListArgs,
): Effect.Effect<FreshTrendingMarketsListResult, CloudRunError> {
    return cloudRunQuery<FreshTrendingMarketsListResult>('assets', 'freshTrendingMarketsList', {
        ...args,
    });
}
