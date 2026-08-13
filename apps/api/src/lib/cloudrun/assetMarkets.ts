import type {
    AssetMarketAggregate,
    GetLatestByAssetIdsEntry,
} from '../../../../cloudrun-assets/src/handlers/assetMarkets';

import { Schema, type Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';


const AssetMarketAggregateSchema = Schema.Struct({
    assetId: Schema.String,
    liquidity: Schema.Number,
    volume24hUSD: Schema.Number,
    volume30dUSD: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    primaryMint: Schema.optionalKey(Schema.String),
    lastComputedAt: Schema.Number,
    minVariantLastFetchedAt: Schema.optionalKey(Schema.Number),
    maxVariantLastFetchedAt: Schema.optionalKey(Schema.Number),
});

const GetLatestByAssetIdResultSchema = Schema.NullOr(AssetMarketAggregateSchema);
const GetLatestByAssetIdsResultSchema = Schema.Array(
    Schema.Struct({
        assetId: Schema.String,
        market: Schema.NullOr(AssetMarketAggregateSchema),
    }),
);

type AssertAssignable<_A extends B, B> = never;
type _AggregateDrift = AssertAssignable<Schema.Schema.Type<typeof AssetMarketAggregateSchema>, AssetMarketAggregate>;
// Element-wise (Schema.Array decodes to readonly arrays; the wire payload is identical).
type _EntryDrift = AssertAssignable<Schema.Schema.Type<typeof GetLatestByAssetIdsResultSchema>[number], GetLatestByAssetIdsResult[number]>;

export type GetLatestByAssetIdArgs = { assetId: string };
export type GetLatestByAssetIdResult = AssetMarketAggregate | null;

export function getLatestByAssetId(args: GetLatestByAssetIdArgs): Effect.Effect<GetLatestByAssetIdResult, CloudRunError> {
    return cloudRunQuery<GetLatestByAssetIdResult>(
        'assets',
        'assetMarketsGetLatestByAssetId',
        { ...args },
        { schema: GetLatestByAssetIdResultSchema },
    );
}

export type GetLatestByAssetIdsArgs = { assetIds: string[] };
export type GetLatestByAssetIdsResult = GetLatestByAssetIdsEntry[];

export function getLatestByAssetIds(args: GetLatestByAssetIdsArgs): Effect.Effect<GetLatestByAssetIdsResult, CloudRunError> {
    return cloudRunQuery<GetLatestByAssetIdsResult>(
        'assets',
        'assetMarketsGetLatestByAssetIds',
        { ...args },
        { schema: GetLatestByAssetIdsResultSchema },
    );
}
