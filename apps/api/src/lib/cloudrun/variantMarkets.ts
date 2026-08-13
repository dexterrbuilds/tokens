import type { GetLatestByMintsEntry } from '../../../../cloudrun-assets/src/handlers/variantMarkets';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type GetLatestByMintsArgs = { mints: string[] };
export type GetLatestByMintsResult = GetLatestByMintsEntry[];

export function getLatestByMints(args: GetLatestByMintsArgs): Effect.Effect<GetLatestByMintsResult, CloudRunError> {
    return cloudRunQuery<GetLatestByMintsResult>('assets', 'variantMarketsGetLatestByMints', {
        ...args,
    });
}
