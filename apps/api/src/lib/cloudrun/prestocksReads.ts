import type {
    GetLatestByMintsEntry,
    PrestocksPriceResult,
} from '../../../../cloudrun-assets/src/handlers/prestocksReads';

import type { Effect } from 'effect';

import { cloudRunQuery } from './client';
import type { CloudRunError } from './errors';

export type { PrestocksPriceResult };

export type GetLatestByMintsArgs = { mints: string[] };
export type GetLatestByMintsResult = GetLatestByMintsEntry[];

export function prestocksGetLatestByMints(
    args: GetLatestByMintsArgs,
): Effect.Effect<GetLatestByMintsResult, CloudRunError> {
    return cloudRunQuery<GetLatestByMintsResult>(
        'assets',
        'prestocksGetLatestByMints',
        { ...args },
    );
}
