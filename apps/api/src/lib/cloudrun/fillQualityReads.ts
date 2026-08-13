import type { GetLatestByMintsEntry } from '../../../../cloudrun-assets/src/handlers/fillQualityReads';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type VariantFillQualityGetLatestByMintsArgs = { mints: string[] };
export type VariantFillQualityGetLatestByMintsResult = GetLatestByMintsEntry[];

export function variantFillQualityGetLatestByMints(
    args: VariantFillQualityGetLatestByMintsArgs,
): Effect.Effect<VariantFillQualityGetLatestByMintsResult, CloudRunError> {
    return cloudRunQuery<VariantFillQualityGetLatestByMintsResult>(
        'assets',
        'variantFillQualityGetLatestByMints',
        { ...args },
    );
}
