import type {
    GetLatestByMintsEntry,
    PrestocksPriceResult,
} from '../../../../cloudrun-assets/src/handlers/prestocksReads';

import { getCloudRunClient } from './client';

export type { PrestocksPriceResult };

export type GetLatestByMintsArgs = { mints: string[] };
export type GetLatestByMintsResult = GetLatestByMintsEntry[];

export async function prestocksGetLatestByMints(
    args: GetLatestByMintsArgs,
): Promise<GetLatestByMintsResult> {
    return getCloudRunClient().query<GetLatestByMintsResult>(
        'assets',
        'prestocksGetLatestByMints',
        { ...args },
    );
}
