import type {
    AssetMarketAggregate,
    GetLatestByAssetIdsEntry,
} from '../../../../cloudrun-assets/src/handlers/assetMarkets';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type GetLatestByAssetIdArgs = { assetId: string };
export type GetLatestByAssetIdResult = AssetMarketAggregate | null;

export function getLatestByAssetId(args: GetLatestByAssetIdArgs): Effect.Effect<GetLatestByAssetIdResult, CloudRunError> {
    return cloudRunQuery<GetLatestByAssetIdResult>('assets', 'assetMarketsGetLatestByAssetId', {
        ...args,
    });
}

export type GetLatestByAssetIdsArgs = { assetIds: string[] };
export type GetLatestByAssetIdsResult = GetLatestByAssetIdsEntry[];

export function getLatestByAssetIds(args: GetLatestByAssetIdsArgs): Effect.Effect<GetLatestByAssetIdsResult, CloudRunError> {
    return cloudRunQuery<GetLatestByAssetIdsResult>('assets', 'assetMarketsGetLatestByAssetIds', {
        ...args,
    });
}
