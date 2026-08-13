import type { LoadAssetBaseForApiResult as HandlerLoadAssetBaseForApiResult } from '../../../../cloudrun-assets/src/handlers/assetsApi';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type LoadAssetBaseForApiArgs = {
    assetId: string;
    includeInactive?: boolean;
    includeVariants?: boolean;
    includeVariantMarkets?: boolean;
    includeFillQuality?: boolean;
    includeAssetMarket?: boolean;
    includeCoingeckoCoin?: boolean;
    includeStockInstrument?: boolean;
    includeStockPrice?: boolean;
};

export type LoadAssetBaseForApiResult = HandlerLoadAssetBaseForApiResult;

export function loadAssetBaseForApi(
    args: LoadAssetBaseForApiArgs,
): Effect.Effect<LoadAssetBaseForApiResult, CloudRunError> {
    return cloudRunQuery<LoadAssetBaseForApiResult>(
        'assets',
        'assetsApiLoadAssetBaseForApi',
        { ...args },
    );
}
