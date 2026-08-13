import type {
    AssetVariantResult,
    ListByAssetIdsEntry,
    ListByMintsEntry,
    SolanaDefaultVariantsViewResult,
    ListSolanaVariantsForApiResult as HandlerListSolanaVariantsForApiResult,
} from '../../../../cloudrun-assets/src/handlers/assetVariants';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type GetByMintArgs = { mint: string; includeInactive?: boolean };
export type GetByMintResult = AssetVariantResult | null;

export function getByMint(args: GetByMintArgs): Effect.Effect<GetByMintResult, CloudRunError> {
    return cloudRunQuery<GetByMintResult>('assets', 'assetVariantsGetByMint', { ...args });
}

export type ListByAssetIdsArgs = { assetIds: string[]; includeInactive?: boolean };
export type ListByAssetIdsResult = ListByAssetIdsEntry[];

export function listByAssetIds(args: ListByAssetIdsArgs): Effect.Effect<ListByAssetIdsResult, CloudRunError> {
    return cloudRunQuery<ListByAssetIdsResult>('assets', 'assetVariantsListByAssetIds', { ...args });
}

export type ListByMintsArgs = { mints: string[]; includeInactive?: boolean };
export type ListByMintsResult = ListByMintsEntry[];

export function listByMints(args: ListByMintsArgs): Effect.Effect<ListByMintsResult, CloudRunError> {
    return cloudRunQuery<ListByMintsResult>('assets', 'assetVariantsListByMints', { ...args });
}

export type GetSolanaDefaultVariantsViewForApiArgs = Record<string, never>;
export type GetSolanaDefaultVariantsViewForApiResult = SolanaDefaultVariantsViewResult | null;

export function getSolanaDefaultVariantsViewForApi(): Effect.Effect<GetSolanaDefaultVariantsViewForApiResult, CloudRunError> {
    return cloudRunQuery<GetSolanaDefaultVariantsViewForApiResult>(
        'assets',
        'assetVariantsGetSolanaDefaultVariantsViewForApi',
        {},
    );
}

export type ListSolanaVariantsForApiArgs = {
    kind?:
        | 'native'
        | 'wrapped'
        | 'bridged'
        | 'spot'
        | 'etf'
        | 'yield'
        | 'leveraged'
        | 'basket'
        | 'lst'
        | 'stablecoin'
        | 'tokenized_equity';
    tierFilter?: 'tier1' | 'tier2' | 'tier3';
    requestedMint?: string;
    variantsMode?: string;
};
export type ListSolanaVariantsForApiResult = HandlerListSolanaVariantsForApiResult;

export function listSolanaVariantsForApi(
    args: ListSolanaVariantsForApiArgs = {},
): Effect.Effect<ListSolanaVariantsForApiResult, CloudRunError> {
    return cloudRunQuery<ListSolanaVariantsForApiResult>(
        'assets',
        'assetVariantsListSolanaVariantsForApi',
        { ...args },
    );
}
