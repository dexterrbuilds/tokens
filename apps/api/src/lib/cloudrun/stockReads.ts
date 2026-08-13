import type {
    StockInstrumentResult,
    StockPriceResult,
    GetInstrumentsByAssetIdsEntry,
    GetPricesByAssetIdsEntry,
} from '../../../../cloudrun-assets/src/handlers/stockReads';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type GetInstrumentByAssetIdArgs = { assetId: string; includeInactive?: boolean };
export type GetInstrumentByAssetIdResult = StockInstrumentResult | null;

export function stockInstrumentsGetByAssetId(
    args: GetInstrumentByAssetIdArgs,
): Effect.Effect<GetInstrumentByAssetIdResult, CloudRunError> {
    return cloudRunQuery<GetInstrumentByAssetIdResult>(
        'assets',
        'stockInstrumentsGetByAssetId',
        { ...args },
    );
}

export type GetInstrumentsByAssetIdsArgs = { assetIds: string[]; includeInactive?: boolean };
export type GetInstrumentsByAssetIdsResult = GetInstrumentsByAssetIdsEntry[];

export function stockInstrumentsGetByAssetIds(
    args: GetInstrumentsByAssetIdsArgs,
): Effect.Effect<GetInstrumentsByAssetIdsResult, CloudRunError> {
    return cloudRunQuery<GetInstrumentsByAssetIdsResult>(
        'assets',
        'stockInstrumentsGetByAssetIds',
        { ...args },
    );
}

export type GetPriceLatestByAssetIdArgs = { assetId: string };
export type GetPriceLatestByAssetIdResult = StockPriceResult | null;

export function stockPricesGetLatestByAssetId(
    args: GetPriceLatestByAssetIdArgs,
): Effect.Effect<GetPriceLatestByAssetIdResult, CloudRunError> {
    return cloudRunQuery<GetPriceLatestByAssetIdResult>(
        'assets',
        'stockPricesGetLatestByAssetId',
        { ...args },
    );
}

export type GetPriceLatestByAssetIdsArgs = { assetIds: string[] };
export type GetPriceLatestByAssetIdsResult = GetPricesByAssetIdsEntry[];

export function stockPricesGetLatestByAssetIds(
    args: GetPriceLatestByAssetIdsArgs,
): Effect.Effect<GetPriceLatestByAssetIdsResult, CloudRunError> {
    return cloudRunQuery<GetPriceLatestByAssetIdsResult>(
        'assets',
        'stockPricesGetLatestByAssetIds',
        { ...args },
    );
}
